// ============================================================
// ADMIN — data.json editor (two-panel: tree + editor)
// Uses framework.js (h, createRoot) loaded before this script.
// ============================================================

// ─── State ───────────────────────────────────────────────────

let data = null;
let dirty = false;
let selectedNode = null;
// selectedNode shapes:
//   { type: 'product-group', gi: N }   gi = index in data.product array
//   { type: 'concept-group', gi: N }
//   { type: 'concept-item', ci: 'name', gi: N }

const openConceptGroups = new Set(); // String(gi) for expanded concept groups

let editingChip = null; // key string of chip being edited
let confirmPending = null; // { action, ds } while modal is open — ds is plain obj from dataset
let submitPending = false; // submit confirmation modal open
let submitting = false; // fetch in progress
let submitError = null; // error string from last failed submit

// ─── Undo ─────────────────────────────────────────────────────
const undoStack = [];
const MAX_UNDO = 50;

function pushUndo() {
  undoStack.push(JSON.parse(JSON.stringify(data)));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function applyUndo() {
  if (!undoStack.length) return;
  data = undoStack.pop();
  // Validate selectedNode is still valid in restored data
  if (selectedNode) {
    const n = selectedNode;
    if (n.type === "product-group" && !data.product[n.gi]) selectedNode = null;
    else if (n.type === "concept-group" && !data.concept.options[n.gi])
      selectedNode = null;
    else if (
      n.type === "concept-item" &&
      !data.concept.options[n.gi]?.items.includes(n.ci)
    )
      selectedNode = null;
  }
  markDirty();
}

// ─── Validation helpers ────────────────────────────────────────

function flashError(el) {
  el.classList.add("is-error");
  el.focus();
  el.select();
  setTimeout(() => el.classList.remove("is-error"), 1200);
}

function isDuplicateLabel(label, v, ds) {
  switch (label) {
    case "product-group":
      return data.product.some((p, i) => p.label === v && i !== +ds.gi);
    case "concept-group":
      return data.concept.options.some((g, i) => g.label === v && i !== +ds.gi);
    case "subconcept-group":
      return data.concept.subConcepts[ds.ci]?.some(
        (g, i) => g.label === v && i !== +ds.scg,
      );
    case "concept-item":
      return data.concept.options[+ds.gi]?.items.some(
        (item) => item === v && item !== ds.ci,
      );
    default:
      return false;
  }
}

function isDuplicateChip(editType, v, ds) {
  switch (editType) {
    case "product-group-item":
      return data.product[+ds.gi]?.items.some(
        (item, i) => item === v && i !== +ds.ii,
      );
    case "concept-group-item":
      return data.concept.options[+ds.gi]?.items.some(
        (item, i) => item === v && i !== +ds.ii,
      );
    case "subconcept-group-item":
      return data.concept.subConcepts[ds.ci]?.[+ds.scg]?.items.some(
        (item, i) => item === v && i !== +ds.scgi,
      );
    default:
      return false;
  }
}
let dragSrc = null; // { key, list, idx, type, ...data attrs }
let dragOverIdx = null; // idx in source list we're hovering over

// Convert a dataset plain-object { gi, ci, ... } back to vdom attr form { "data-gi", ... }
function dsToAttrs(ds) {
  return Object.fromEntries(
    Object.entries(ds)
      .filter(([k]) => k !== "action")
      .map(([k, v]) => [`data-${k}`, v]),
  );
}

// Human-readable description of what's being deleted, for the modal body
function getDeleteSubject(action, ds) {
  const gi = +ds.gi,
    ii = +ds.ii,
    scg = +ds.scg,
    scgi = +ds.scgi;
  switch (action) {
    case "del-product-group":
      return data.product[gi]?.label ?? "";
    case "del-product-group-item":
      return data.product[gi]?.items[ii] ?? "";
    case "del-concept-group":
      return data.concept.options[gi]?.label ?? "";
    case "del-concept-group-item":
      return data.concept.options[gi]?.items[ii] ?? "";
    case "del-concept-item":
      return ds.ci ?? "";
    case "del-subconcept-group":
      return data.concept.subConcepts[ds.ci]?.[scg]?.label ?? "";
    case "del-subconcept-group-item":
      return data.concept.subConcepts[ds.ci]?.[scg]?.items[scgi] ?? "";
    default:
      return "";
  }
}

function getDeleteTypeLabel(action) {
  switch (action) {
    case "del-product-group":
      return "브랜드";
    case "del-product-group-item":
      return "제품";
    case "del-concept-group":
      return "컨셉 그룹";
    case "del-concept-group-item":
      return "컨셉";
    case "del-concept-item":
      return "컨셉";
    case "del-subconcept-group":
      return "세부 컨셉 그룹";
    case "del-subconcept-group-item":
      return "세부 컨셉";
    default:
      return "항목";
  }
}

// ─── Root ────────────────────────────────────────────────────

const root = createRoot(document.getElementById("admin-main"));

function rerender() {
  if (!data) return;
  root.render(App());
}

function markDirty() {
  dirty = true;
  document.getElementById("submit-btn").classList.add("dirty");
  rerender();
}

function selectNode(node) {
  selectedNode = node;
  rerender();
}

// ─── Delete execution (called after modal confirms) ──────────

function executeDelete(action, ds) {
  pushUndo();
  switch (action) {
    case "del-format":
      data.format.splice(+ds.fi, 1);
      break;
    case "del-product-group":
      if (selectedNode?.type === "product-group") selectedNode = null;
      data.product.splice(+ds.gi, 1);
      break;
    case "del-product-group-item":
      data.product[+ds.gi].items.splice(+ds.ii, 1);
      break;
    case "del-concept-group": {
      const gi = +ds.gi;
      if (
        selectedNode?.type === "concept-group" ||
        selectedNode?.type === "concept-item"
      )
        selectedNode = null;
      for (const item of data.concept.options[gi].items)
        delete data.concept.subConcepts[item];
      const shifted = new Set();
      for (const key of openConceptGroups) {
        const idx = +key;
        if (idx < gi) shifted.add(key);
        else if (idx > gi) shifted.add(String(idx - 1));
      }
      openConceptGroups.clear();
      for (const k of shifted) openConceptGroups.add(k);
      data.concept.options.splice(gi, 1);
      break;
    }
    case "del-concept-group-item": {
      const gi = +ds.gi;
      const item = data.concept.options[gi].items[+ds.ii];
      data.concept.options[gi].items.splice(+ds.ii, 1);
      if (item in data.concept.subConcepts)
        delete data.concept.subConcepts[item];
      if (selectedNode?.type === "concept-item" && selectedNode.ci === item)
        selectedNode = { type: "concept-group", gi };
      break;
    }
    case "del-concept-item": {
      const gi = +ds.gi;
      const ci = ds.ci;
      const idx = data.concept.options[gi].items.indexOf(ci);
      if (idx !== -1) data.concept.options[gi].items.splice(idx, 1);
      if (ci in data.concept.subConcepts) delete data.concept.subConcepts[ci];
      selectedNode = { type: "concept-group", gi };
      break;
    }
    case "del-subconcept-group":
      data.concept.subConcepts[ds.ci].splice(+ds.scg, 1);
      break;
    case "del-subconcept-group-item":
      data.concept.subConcepts[ds.ci][+ds.scg].items.splice(+ds.scgi, 1);
      break;
  }
  markDirty();
}

// ─── Stable event handlers ───────────────────────────────────

const onAppClick = function (e) {
  // Backdrop click dismisses modals
  if (confirmPending && !e.target.closest(".modal-dialog")) {
    confirmPending = null;
    rerender();
    return;
  }
  if (submitPending && !submitting && !e.target.closest(".modal-dialog")) {
    submitPending = false;
    submitError = null;
    rerender();
    return;
  }

  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const ds = btn.dataset;

  // First click on any del-* action opens the modal instead of executing
  if (ds.action.startsWith("del-")) {
    confirmPending = { action: ds.action, ds: { ...ds } };
    rerender();
    return;
  }

  switch (ds.action) {
    case "edit-chip":
      editingChip = ds.chipKey;
      rerender();
      setTimeout(() => {
        const inp = document.querySelector("[data-edit-key]");
        if (inp) {
          inp.focus();
          inp.select();
        }
      }, 0);
      break;

    case "select-product-group":
      selectNode({ type: "product-group", gi: +ds.gi });
      break;
    case "select-concept-group": {
      const gi = +ds.gi;
      openConceptGroups.has(String(gi))
        ? openConceptGroups.delete(String(gi))
        : openConceptGroups.add(String(gi));
      selectNode({ type: "concept-group", gi });
      break;
    }
    case "select-concept-item":
      selectNode({ type: "concept-item", ci: ds.ci, gi: +ds.gi });
      break;

    // ── Product ──
    case "add-product-group": {
      pushUndo();
      data.product.push({ label: "새 브랜드", items: [] });
      selectNode({ type: "product-group", gi: data.product.length - 1 });
      markDirty();
      break;
    }

    // ── Concept groups ──
    case "add-concept-group": {
      pushUndo();
      data.concept.options.push({ label: "새 그룹", items: [] });
      const newGi = data.concept.options.length - 1;
      selectNode({ type: "concept-group", gi: newGi });
      markDirty();
      break;
    }

    // ── Sub-concepts ──
    case "add-subconcept-group":
      pushUndo();
      if (!(ds.ci in data.concept.subConcepts))
        data.concept.subConcepts[ds.ci] = [];
      data.concept.subConcepts[ds.ci].push({ label: "새 그룹", items: [] });
      markDirty();
      break;

    case "cancel-delete":
      confirmPending = null;
      rerender();
      break;

    case "confirm-delete": {
      const { action, ds: storedDs } = confirmPending;
      confirmPending = null;
      executeDelete(action, storedDs);
      break;
    }

    case "confirm-add": {
      commitAdd(ds, "");
      break;
    }

    case "cancel-submit":
      submitPending = false;
      submitError = null;
      rerender();
      break;

    case "confirm-submit":
      submitData();
      break;
  }
};

const onAppKeydown = function (e) {
  if (e.key === "Escape" && confirmPending) {
    confirmPending = null;
    rerender();
    return;
  }
  if (e.key === "Escape" && submitPending && !submitting) {
    submitPending = false;
    submitError = null;
    rerender();
    return;
  }
  const inp = e.target;
  if (inp.dataset.editKey) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveChipEdit(inp);
    } else if (e.key === "Escape") {
      // If this was a newly-added chip (editOrig === ""), delete the empty entry
      if (inp.dataset.editOrig === "") {
        inp.value = "";
        saveChipEdit(inp);
      } else {
        editingChip = null;
        rerender();
      }
    }
    return;
  }
};

const onAppChange = function (e) {
  const el = e.target;
  const ds = el.dataset;
  if (!ds.label) return;
  const v = el.value.trim();
  if (!v) {
    el.value = ds.orig || "";
    return;
  }
  if (isDuplicateLabel(ds.label, v, ds)) {
    el.value = ds.orig || "";
    flashError(el);
    return;
  }
  pushUndo();

  switch (ds.label) {
    case "product-group":
      data.product[+ds.gi].label = v;
      break;
    case "concept-group":
      data.concept.options[+ds.gi].label = v;
      break;
    case "subconcept-group":
      data.concept.subConcepts[ds.ci][+ds.scg].label = v;
      break;
    case "concept-item": {
      const gi = +ds.gi;
      const oldCi = ds.ci;
      const idx = data.concept.options[gi].items.indexOf(oldCi);
      if (idx !== -1) data.concept.options[gi].items[idx] = v;
      if (oldCi in data.concept.subConcepts) {
        data.concept.subConcepts[v] = data.concept.subConcepts[oldCi];
        delete data.concept.subConcepts[oldCi];
      }
      selectedNode = { type: "concept-item", ci: v, gi };
      break;
    }
  }
  markDirty();
};

// ─── Shared helpers ───────────────────────────────────────────

function commitAdd(ds, v) {
  pushUndo();
  let newKey = null;
  switch (ds.add) {
    case "product-group-item": {
      const arr = data.product[+ds.gi].items;
      arr.push(v);
      newKey = `p:${ds.gi}:${arr.length - 1}`;
      break;
    }
    case "concept-group-item": {
      const gi = +ds.gi;
      const arr = data.concept.options[gi].items;
      arr.push(v);
      newKey = `ci:${ds.gi}:${arr.length - 1}`;
      break;
    }
    case "subconcept-group-item": {
      const arr = data.concept.subConcepts[ds.ci][+ds.scg].items;
      arr.push(v);
      newKey = `s:${ds.ci}:${ds.scg}:${arr.length - 1}`;
      break;
    }
  }

  if (newKey) {
    editingChip = newKey;
    rerender();
    setTimeout(() => {
      const inp = document.querySelector("[data-edit-key]");
      if (inp) {
        inp.focus();
        inp.select();
      }
    }, 0);
  }
  markDirty();
}

function saveChipEdit(inp) {
  const { editType, editOrig, editKey } = inp.dataset;
  const v = inp.value.trim();
  editingChip = null;

  // If the chip was left empty, delete it (push undo only for existing chips)
  if (!v) {
    if (editOrig !== "") pushUndo();
    switch (editType) {
      case "product-group-item":
        data.product[+inp.dataset.gi].items.splice(+inp.dataset.ii, 1);
        break;
      case "concept-group-item":
        data.concept.options[+inp.dataset.gi].items.splice(+inp.dataset.ii, 1);
        if (editOrig && editOrig in data.concept.subConcepts) {
          delete data.concept.subConcepts[editOrig];
        }
        break;
      case "subconcept-group-item":
        data.concept.subConcepts[inp.dataset.ci][+inp.dataset.scg].items.splice(
          +inp.dataset.scgi,
          1,
        );
        break;
    }
    markDirty();
    return;
  }

  // If the value hasn't changed, just exit edit mode
  if (v === editOrig && editOrig !== "") {
    rerender();
    return;
  }

  // Duplicate check — keep in edit mode with error highlight
  if (v && isDuplicateChip(editType, v, inp.dataset)) {
    editingChip = editKey;
    rerender();
    setTimeout(() => {
      const newInp = document.querySelector("[data-edit-key]");
      if (newInp) flashError(newInp);
    }, 0);
    return;
  }

  // New chips already have a snapshot from commitAdd; only push for editing existing chips
  if (editOrig !== "") pushUndo();

  // Save the new value
  switch (editType) {
    case "product-group-item":
      data.product[+inp.dataset.gi].items[+inp.dataset.ii] = v;
      break;
    case "concept-group-item": {
      data.concept.options[+inp.dataset.gi].items[+inp.dataset.ii] = v;
      // Handle renaming concept subConcepts reference
      if (editOrig && editOrig in data.concept.subConcepts) {
        data.concept.subConcepts[v] = data.concept.subConcepts[editOrig];
        delete data.concept.subConcepts[editOrig];
      } else if (!(v in data.concept.subConcepts)) {
        data.concept.subConcepts[v] = [];
      }
      break;
    }
    case "subconcept-group-item":
      data.concept.subConcepts[inp.dataset.ci][+inp.dataset.scg].items[
        +inp.dataset.scgi
      ] = v;
      break;
  }
  markDirty();
}

const onAppInput = function (e) {
  const inp = e.target;
  if (inp.dataset.editKey) {
    inp.size = Math.max(4, inp.value.length + 2);
  }
};

const onAppFocusOut = function (e) {
  const inp = e.target;
  if (inp.dataset.editKey && editingChip !== null) saveChipEdit(inp);
};

const onAppDragStart = function (e) {
  const chip = e.target.closest("[data-chip-key]");
  if (!chip) return;
  dragSrc = {
    key: chip.dataset.chipKey,
    list: chip.dataset.chipList,
    idx: +chip.dataset.chipIdx,
    type: chip.dataset.chipType,
    gi: chip.dataset.gi !== undefined ? +chip.dataset.gi : undefined,
    ii: chip.dataset.ii !== undefined ? +chip.dataset.ii : undefined,
    ci: chip.dataset.ci,
    scg: chip.dataset.scg !== undefined ? +chip.dataset.scg : undefined,
    scgi: chip.dataset.scgi !== undefined ? +chip.dataset.scgi : undefined,
  };
  dragOverIdx = null;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", chip.dataset.chipKey);
  rerender();
};

const onAppDragOver = function (e) {
  if (!dragSrc) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const chip = e.target.closest("[data-chip-key]");
  if (!chip || chip.dataset.chipList !== dragSrc.list) {
    if (dragOverIdx !== null) {
      dragOverIdx = null;
      rerender();
    }
    return;
  }
  const newIdx = +chip.dataset.chipIdx;
  if (newIdx !== dragSrc.idx && dragOverIdx !== newIdx) {
    dragOverIdx = newIdx;
    rerender();
  }
};

const onAppDrop = function (e) {
  e.preventDefault();
  if (!dragSrc || dragOverIdx === null || dragOverIdx === dragSrc.idx) {
    dragSrc = null;
    dragOverIdx = null;
    rerender();
    return;
  }
  const srcIdx = dragSrc.idx;
  const tgtIdx = dragOverIdx;
  let items;
  switch (dragSrc.type) {
    case "product-group-item":
      items = data.product[dragSrc.gi].items;
      break;
    case "concept-group-item":
      items = data.concept.options[dragSrc.gi].items;
      break;
    case "subconcept-group-item":
      items = data.concept.subConcepts[dragSrc.ci][dragSrc.scg].items;
      break;
    case "subconcept-group":
      items = data.concept.subConcepts[dragSrc.ci];
      break;
  }
  dragSrc = null;
  dragOverIdx = null;
  if (items) {
    pushUndo();
    const [moved] = items.splice(srcIdx, 1);
    items.splice(tgtIdx > srcIdx ? tgtIdx - 1 : tgtIdx, 0, moved);
    markDirty();
  } else rerender();
};

const onAppDragEnd = function (e) {
  if (dragSrc || dragOverIdx !== null) {
    dragSrc = null;
    dragOverIdx = null;
    rerender();
  }
};

/// ── DeleteBtn: danger button — click opens the confirmation modal ──
function DeleteBtn(action, attrs, className, ...children) {
  return h(
    "button",
    { type: "button", className, "data-action": action, ...attrs },
    ...children,
  );
}

// ── ChipDelBtn: × button — click opens the confirmation modal ──
function ChipDelBtn(action, attrs) {
  return h(
    "button",
    {
      type: "button",
      className: "chip-del",
      tabIndex: -1,
      "aria-label": "삭제",
      "data-action": action,
      ...attrs,
    },
    "×",
  );
}

function Chip(text, delAction, delAttrs, opts) {
  // opts = { key, list, idx, type } — enables edit + drag; omit for plain chips
  if (!opts) {
    return h(
      "span",
      { className: "chip" },
      h("span", {}, text),
      ChipDelBtn(delAction, delAttrs),
    );
  }
  const { key, list, idx, type } = opts;
  const isEditing = editingChip === key;
  const isDragging = dragSrc?.key === key;
  const isDragOver =
    !isDragging && dragOverIdx === idx && dragSrc?.list === list;
  return h(
    "span",
    {
      className:
        "chip" +
        (isDragging ? " chip-dragging" : "") +
        (isDragOver ? " chip-drag-over" : ""),
      draggable: !isEditing,
      "data-chip-key": key,
      "data-chip-list": list,
      "data-chip-idx": idx,
      "data-chip-type": type,
      ...delAttrs,
    },
    h(
      "span",
      { className: "material-symbols-rounded chip-handle" },
      "drag_indicator",
    ),
    isEditing
      ? h("input", {
          type: "text",
          className: "chip-edit-inp",
          value: text,
          size: Math.max(4, text.length + 2),
          "data-edit-key": key,
          "data-edit-orig": text,
          "data-edit-type": type,
          ...delAttrs,
        })
      : h(
          "span",
          {
            className: "chip-text",
            "data-action": "edit-chip",
            "data-chip-key": key,
          },
          text,
        ),
    ChipDelBtn(delAction, delAttrs),
  );
}

function AddInput(addAction, attrs, label) {
  return h(
    "button",
    {
      className: "tree-add-btn editor-add-btn",
      type: "button",
      "data-action": "confirm-add",
      "data-add": addAction,
      ...attrs,
    },
    h("span", { className: "material-symbols-rounded" }, "add"),
    label,
  );
}

// ─── Tree panel ───────────────────────────────────────────────

function TreeLeaf(action, attrs, label, selected) {
  return h(
    "button",
    {
      className: "tree-leaf" + (selected ? " selected" : ""),
      type: "button",
      "data-action": action,
      ...attrs,
    },
    label,
  );
}

function TreePanel() {
  const productGroups = data.product.map((x, i) => ({ x, i }));

  return h(
    "nav",
    { className: "tree-panel" },

    // ── PRODUCT ──
    h("div", { className: "tree-section-header" }, "브랜드"),
    h(
      "ul",
      { className: "tree-section-body" },
      ...productGroups.map(({ x, i }) =>
        h(
          "li",
          {},
          TreeLeaf(
            "select-product-group",
            { "data-gi": i },
            x.label,
            selectedNode?.type === "product-group" && selectedNode.gi === i,
          ),
        ),
      ),
    ),
    h(
      "button",
      {
        className: "tree-add-btn",
        type: "button",
        "data-action": "add-product-group",
      },
      h("span", { className: "material-symbols-rounded" }, "add"),
      "브랜드 추가",
    ),

    // ── CONCEPT ──
    h("div", { className: "tree-section-header" }, "컨셉 그룹"),
    h(
      "ul",
      { className: "tree-section-body" },
      ...data.concept.options.map((group, gi) => {
        const groupOpen = openConceptGroups.has(String(gi));
        const groupSelected =
          selectedNode?.type === "concept-group" && selectedNode.gi === gi;
        return h(
          "li",
          { className: "tree-group-wrap" },
          h(
            "button",
            {
              className: "tree-group-btn" + (groupSelected ? " selected" : ""),
              type: "button",
              "data-action": "select-concept-group",
              "data-gi": gi,
            },
            h("span", { className: "tree-group-label" }, group.label),
            h(
              "span",
              {
                className:
                  "material-symbols-rounded tree-chevron" +
                  (groupOpen ? " open" : ""),
              },
              "chevron_right",
            ),
          ),
          groupOpen
            ? h(
                "ul",
                { className: "tree-group-items" },
                ...group.items.map((item) => {
                  const sel =
                    selectedNode?.type === "concept-item" &&
                    selectedNode.ci === item;
                  return h(
                    "li",
                    { className: "tree-leaf-wrap" },
                    TreeLeaf(
                      "select-concept-item",
                      { "data-ci": item, "data-gi": gi },
                      item,
                      sel,
                    ),
                  );
                }),
              )
            : null,
        );
      }),
    ),
    h(
      "button",
      {
        className: "tree-add-btn",
        type: "button",
        "data-action": "add-concept-group",
      },
      h("span", { className: "material-symbols-rounded" }, "add"),
      "컨셉 그룹 추가",
    ),
  );
}

// ─── Editor panel ─────────────────────────────────────────────

function EditorPanel() {
  if (!selectedNode) {
    return h(
      "div",
      { className: "editor-empty" },
      "왼쪽에서 항목을 선택하세요.",
    );
  }
  switch (selectedNode.type) {
    case "product-group":
      return ProductGroupEditor(selectedNode.gi);
    case "concept-group":
      return ConceptGroupEditor(selectedNode.gi);
    case "concept-item":
      return ConceptItemEditor(selectedNode.ci, selectedNode.gi);
  }
}

function ProductGroupEditor(gi) {
  const group = data.product[gi];
  return h(
    "div",
    { className: "editor-section" },
    h(
      "div",
      { className: "editor-header-group" },
      h(
        "div",
        { className: "editor-breadcrumb" },
        h("span", { className: "breadcrumb-current" }, "브랜드"),
        h(
          "span",
          { className: "material-symbols-rounded breadcrumb-sep" },
          "chevron_right",
        ),
        h("span", { className: "breadcrumb-current" }, group.label),
      ),
      h(
        "div",
        { className: "editor-title-row" },
        h("input", {
          type: "text",
          className: "editor-title-inp",
          value: group.label,
          placeholder: "브랜드명",
          "data-orig": group.label,
          "data-label": "product-group",
          "data-gi": gi,
        }),
        DeleteBtn(
          "del-product-group",
          { "data-gi": gi },
          "btn-danger-sm",
          h("span", { className: "material-symbols-rounded" }, "delete"),
          "브랜드 삭제",
        ),
      ),
      h(
        "p",
        { className: "editor-subtitle" },
        "각 브랜드별 소재가 홍보하는 제품을 입력해요. 소재명의 두 번째 자리에 들어가는 항목이에요",
      ),
    ),
    h("hr", { className: "editor-divider" }),
    h(
      "div",
      { className: "group-box" },
      h(
        "div",
        { className: "group-items" },
        h(
          "p",
          { className: "editor-hint" },
          "드래그해서 순서를 바꾸고, 클릭해서 이름을 수정할 수 있어요",
        ),
        h(
          "div",
          { className: "chip-wrap" },
          ...group.items.map((item, ii) =>
            Chip(
              item,
              "del-product-group-item",
              { "data-gi": gi, "data-ii": ii },
              {
                key: `p:${gi}:${ii}`,
                list: `p:${gi}`,
                idx: ii,
                type: "product-group-item",
              },
            ),
          ),
          AddInput("product-group-item", { "data-gi": gi }, "제품 추가"),
        ),
      ),
    ),
  );
}

function ConceptGroupEditor(gi) {
  const group = data.concept.options[gi];
  return h(
    "div",
    { className: "editor-section" },
    h(
      "div",
      { className: "editor-header-group" },
      h(
        "div",
        { className: "editor-breadcrumb" },
        h("span", { className: "breadcrumb-current" }, "컨셉"),
        h(
          "span",
          { className: "material-symbols-rounded breadcrumb-sep" },
          "chevron_right",
        ),
        h("span", { className: "breadcrumb-current" }, group.label),
      ),
      h(
        "div",
        { className: "editor-title-row" },
        h("input", {
          type: "text",
          className: "editor-title-inp",
          value: group.label,
          placeholder: "컨셉 그룹명",
          "data-orig": group.label,
          "data-label": "concept-group",
          "data-gi": gi,
        }),
        DeleteBtn(
          "del-concept-group",
          { "data-gi": gi },
          "btn-danger-sm",
          h("span", { className: "material-symbols-rounded" }, "delete"),
          "컨셉 그룹 삭제",
        ),
      ),
      h(
        "p",
        { className: "editor-subtitle" },
        "컨셉은 소재 분석에 있어 가장 중요한 인덱스 중 하나에요. ",
        h("code", {}, "컨셉"),
        " 그리고 ",
        h("code", {}, "세부 컨셉"),
        " 의 2단계로 나누어 분석할 수 있게끔 구성해요 ",
        h("code", {}, "컨셉 그룹"),
        " 과 ",
        h("code", {}, "세부 컨셉 그룹"),
        " 은 편의를 위한 구분이며 실제 소재명에 적용되지는 않아요",
      ),
    ),
    h("hr", { className: "editor-divider" }),
    h(
      "div",
      { className: "group-box" },
      h(
        "div",
        { className: "group-items" },
        h(
          "p",
          { className: "editor-hint" },
          "드래그해서 순서를 바꾸고, 세부 뱃지를 클릭하면 세부 컨셉 편집 페이지로 이동해요.",
        ),
        h(
          "div",
          { className: "chip-wrap" },
          ...group.items.map((item, ii) => {
            const key = `ci:${gi}:${ii}`;
            const isEditing = editingChip === key;
            const isDragging = dragSrc?.key === key;
            const isDragOver =
              !isDragging && dragOverIdx === ii && dragSrc?.list === `ci:${gi}`;
            return h(
              "div",
              {
                className:
                  "concept-item-row" +
                  (isDragging ? " chip-dragging" : "") +
                  (isDragOver ? " chip-drag-over" : ""),
                draggable: !isEditing,
                "data-chip-key": key,
                "data-chip-list": `ci:${gi}`,
                "data-chip-idx": ii,
                "data-chip-type": "concept-group-item",
                "data-gi": gi,
                "data-ii": ii,
              },
              h(
                "span",
                { className: "material-symbols-rounded chip-handle" },
                "drag_indicator",
              ),
              isEditing
                ? h("input", {
                    type: "text",
                    className: "chip-edit-inp",
                    value: item,
                    size: Math.max(4, item.length + 2),
                    "data-edit-key": key,
                    "data-edit-orig": item,
                    "data-edit-type": "concept-group-item",
                    "data-gi": gi,
                    "data-ii": ii,
                  })
                : h(
                    "span",
                    {
                      className: "chip-text",
                      "data-action": "edit-chip",
                      "data-chip-key": key,
                    },
                    item,
                  ),
              data.concept.subConcepts[item]?.length > 0
                ? h(
                    "button",
                    {
                      className: "has-sub-badge",
                      type: "button",
                      "data-action": "select-concept-item",
                      "data-ci": item,
                      "data-gi": gi,
                    },
                    "세부",
                  )
                : null,
              ChipDelBtn("del-concept-group-item", {
                "data-gi": gi,
                "data-ii": ii,
              }),
            );
          }),
          AddInput("concept-group-item", { "data-gi": gi }, "컨셉 추가"),
        ),
      ),
    ),
  );
}

function ConceptItemEditor(ci, gi) {
  const groups = data.concept.subConcepts[ci] ?? [];
  const parentLabel = data.concept.options[gi]?.label ?? "";

  return h(
    "div",
    { className: "editor-section" },
    h(
      "div",
      { className: "editor-header-group" },
      h(
        "div",
        { className: "editor-breadcrumb" },
        h("span", { className: "breadcrumb-current" }, "컨셉"),
        h(
          "span",
          { className: "material-symbols-rounded breadcrumb-sep" },
          "chevron_right",
        ),
        h(
          "button",
          {
            className: "breadcrumb-btn",
            type: "button",
            "data-action": "select-concept-group",
            "data-gi": gi,
          },
          parentLabel,
        ),
        h(
          "span",
          { className: "material-symbols-rounded breadcrumb-sep" },
          "chevron_right",
        ),
        h("span", { className: "breadcrumb-current" }, ci),
      ),
      h(
        "div",
        { className: "editor-title-row" },
        h("input", {
          type: "text",
          className: "editor-title-inp",
          value: ci,
          placeholder: "컨셉명",
          "data-orig": ci,
          "data-label": "concept-item",
          "data-ci": ci,
          "data-gi": gi,
        }),
        DeleteBtn(
          "del-concept-item",
          { "data-ci": ci, "data-gi": gi },
          "btn-danger-sm",
          h("span", { className: "material-symbols-rounded" }, "delete"),
          "컨셉 삭제",
        ),
      ),
      h(
        "p",
        { className: "editor-subtitle" },
        "세부 컨셉 그룹과 그 아래의 세부 컨셉들을 자유롭게 설정해보세요",
      ),
    ),
    h("hr", { className: "editor-divider" }),
    h(
      "div",
      { className: "ci-card" },
      h(
        "div",
        { className: "ci-card-body" },
        groups.length === 0
          ? h(
              "p",
              { className: "editor-hint" },
              "아래 버튼으로 첫 세부 컨셉 그룹을 추가하세요.",
            )
          : h(
              "div",
              { className: "ci-sub-grid" },
              ...groups.map((group, scg) => {
                const sgKey = `sg:${ci}:${scg}`;
                const sgDragging = dragSrc?.key === sgKey;
                const sgDragOver =
                  !sgDragging &&
                  dragOverIdx === scg &&
                  dragSrc?.list === `sg:${ci}`;
                return h(
                  "div",
                  {
                    className:
                      "group-box" +
                      (sgDragging ? " chip-dragging" : "") +
                      (sgDragOver ? " group-drag-over" : ""),
                    draggable: true,
                    "data-chip-key": sgKey,
                    "data-chip-list": `sg:${ci}`,
                    "data-chip-idx": scg,
                    "data-chip-type": "subconcept-group",
                    "data-ci": ci,
                    "data-scg": scg,
                  },
                  h(
                    "div",
                    { className: "group-header" },
                    h(
                      "span",
                      {
                        className:
                          "material-symbols-rounded chip-handle group-drag-handle",
                      },
                      "drag_indicator",
                    ),
                    h("input", {
                      type: "text",
                      className: "group-label-inp",
                      value: group.label,
                      placeholder: "세부 컨셉 그룹명",
                      "data-orig": group.label,
                      "data-label": "subconcept-group",
                      "data-ci": ci,
                      "data-scg": scg,
                    }),
                    DeleteBtn(
                      "del-subconcept-group",
                      { "data-ci": ci, "data-scg": scg },
                      "btn-danger-xs",
                      h(
                        "span",
                        { className: "material-symbols-rounded" },
                        "delete",
                      ),
                      "세부 컨셉 삭제",
                    ),
                  ),
                  h(
                    "div",
                    { className: "group-items" },
                    h(
                      "div",
                      { className: "chip-wrap" },
                      ...group.items.map((item, scgi) =>
                        Chip(
                          item,
                          "del-subconcept-group-item",
                          {
                            "data-ci": ci,
                            "data-scg": scg,
                            "data-scgi": scgi,
                          },
                          {
                            key: `s:${ci}:${scg}:${scgi}`,
                            list: `s:${ci}:${scg}`,
                            idx: scgi,
                            type: "subconcept-group-item",
                          },
                        ),
                      ),
                      AddInput(
                        "subconcept-group-item",
                        {
                          "data-ci": ci,
                          "data-scg": scg,
                        },
                        "세부 컨셉 추가",
                      ),
                    ),
                  ),
                );
              }),
            ),
        h(
          "button",
          {
            className: "tree-add-btn editor-add-btn",
            type: "button",
            "data-action": "add-subconcept-group",
            "data-ci": ci,
          },
          h("span", { className: "material-symbols-rounded" }, "add"),
          "세부 컨셉 그룹 추가",
        ),
      ),
    ),
  );
}

// ─── Footer ───────────────────────────────────────────────────

function Footer() {
  return h(
    "footer",
    { className: "app-footer" },
    h(
      "a",
      {
        className: "footer-link",
        href: "https://github.com/pepsi-monster/ad-name-generator",
        target: "_blank",
        rel: "noreferrer",
      },
      h("span", {
        className: "footer-icon",
        innerHTML:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>',
      }),
      "GitHub에서 보기",
    ),
    h(
      "a",
      {
        className: "footer-link",
        href: "http://appsilon.kr/",
        target: "_blank",
        rel: "noreferrer",
      },
      h("span", {
        className: "footer-icon",
        innerHTML:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 295 311" width="13" height="14" fill="currentColor"><path d="M77.1465 15.1099L123.693 26.2176L55.8606 310.643L9.30591 299.54L77.1465 15.1099Z"/><path d="M281.688 156.179L294.532 202.284L16.6762 285.842L0 234.652L281.688 156.179Z"/><path d="M33.6174 33.8025L67.4788 8.0734e-07L274.067 206.937L240.205 240.739L33.6174 33.8025Z"/></svg>',
      }),
      "APPSILON Corp.",
    ),
  );
}

// ─── Delete confirmation modal ────────────────────────────────

function Modal() {
  const { action, ds } = confirmPending;
  const subject = getDeleteSubject(action, ds);
  const typeLabel = getDeleteTypeLabel(action);
  const confirmAttrs = dsToAttrs(ds);

  return h(
    "div",
    { className: "modal-overlay" },
    h(
      "div",
      { className: "modal-dialog" },
      h("h2", { className: "modal-title" }, "정말 삭제할까요?"),
      h(
        "p",
        { className: "modal-body" },
        subject
          ? h("span", { className: "modal-subject" }, `'${subject}'`)
          : `이 ${typeLabel}`,
        subject ? ` ${typeLabel}을(를)` : "을(를)",
        " 삭제하면 되돌릴 수 없어요",
      ),
      h(
        "div",
        { className: "modal-actions" },
        h(
          "button",
          {
            type: "button",
            className: "modal-cancel",
            "data-action": "cancel-delete",
          },
          "취소",
        ),
        h(
          "button",
          {
            type: "button",
            className: "modal-confirm",
            "data-action": "confirm-delete",
            ...confirmAttrs,
          },
          "삭제",
        ),
      ),
    ),
  );
}

// ─── Submit confirmation modal ────────────────────────────────

function SubmitModal() {
  return h(
    "div",
    { className: "modal-overlay" },
    h(
      "div",
      { className: "modal-dialog" },
      h("h2", { className: "modal-title" }, "변경 사항 적용"),
      h(
        "p",
        { className: "modal-body" },
        submitting
          ? "서버에 전송 중이에요..."
          : submitError
            ? submitError
            : "편집한 데이터를 적용할까요?",
      ),
      h(
        "div",
        { className: "modal-actions" },
        h(
          "button",
          {
            type: "button",
            className: "modal-cancel",
            "data-action": "cancel-submit",
            disabled: submitting,
          },
          "취소",
        ),
        h(
          "button",
          {
            type: "button",
            className: "modal-confirm-primary",
            "data-action": "confirm-submit",
            disabled: submitting,
          },
          submitting ? "전송 중..." : "전송",
        ),
      ),
    ),
  );
}

// ─── App root ─────────────────────────────────────────────────

function App() {
  return h(
    "div",
    { className: "admin-app-root" },
    h(
      "div",
      {
        id: "admin-app-inner",
        onClick: onAppClick,
        onKeydown: onAppKeydown,
        onChange: onAppChange,
        onInput: onAppInput,
        onFocusout: onAppFocusOut,
        onDragstart: onAppDragStart,
        onDragover: onAppDragOver,
        onDrop: onAppDrop,
        onDragend: onAppDragEnd,
      },
      TreePanel(),
      h("div", { className: "editor-panel" }, EditorPanel()),
      confirmPending ? Modal() : null,
      submitPending ? SubmitModal() : null,
    ),
    Footer(),
  );
}

// ─── Submit ───────────────────────────────────────────────────

async function submitData() {
  submitting = true;
  submitError = null;
  rerender();
  try {
    // TODO: Replace with actual endpoint URL
    // TODO: Add auth headers, e.g.: Authorization: `Bearer ${TOKEN}`
    const res = await fetch("https://TODO_REPLACE_WITH_ENDPOINT", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
    dirty = false;
    submitPending = false;
    submitting = false;
    document.getElementById("submit-btn").classList.remove("dirty");
    rerender();
  } catch (err) {
    submitError = err.message || "전송에 실패했어요. 다시 시도해주세요.";
    submitting = false;
    rerender();
  }
}

window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

document.getElementById("submit-btn").addEventListener("click", function () {
  if (!dirty) return;
  submitPending = true;
  submitError = null;
  rerender();
});

document.addEventListener("keydown", function (e) {
  if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (!data) return;
    e.preventDefault();
    applyUndo();
  }
});

// ─── Init ─────────────────────────────────────────────────────

fetch("data.json")
  .then((r) => r.json())
  .then((d) => {
    data = d;
    rerender();
  })
  .catch(() => {
    document.getElementById("admin-main").textContent =
      "data.json을 불러오지 못했어요. 파일이 존재하는지 확인해주세요.";
  });
