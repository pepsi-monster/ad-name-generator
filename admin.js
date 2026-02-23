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
let addingChip = null; // addKey of the list currently showing a blank chip
let dragSrc = null; // { key, list, idx, type, ...data attrs }
let dragOverIdx = null; // idx in source list we're hovering over

function makeAddKey(addAction, attrs) {
  return `${addAction}:${attrs["data-gi"] ?? attrs.gi ?? ""}:${attrs["data-ci"] ?? attrs.ci ?? ""}:${attrs["data-scg"] ?? attrs.scg ?? ""}`;
}

// ─── Root ────────────────────────────────────────────────────

const root = createRoot(document.getElementById("admin-main"));

function rerender() {
  if (!data) return;
  root.render(App());
}

function markDirty() {
  dirty = true;
  const btn = document.getElementById("download-btn");
  btn.classList.add("dirty");
  btn.textContent = "● data.json 다운로드";
  rerender();
}

function selectNode(node) {
  selectedNode = node;
  rerender();
}

// ─── Stable event handlers ───────────────────────────────────

const onAppClick = function (e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const ds = btn.dataset;

  switch (ds.action) {
    case "start-add": {
      addingChip = ds.addKey;
      rerender();
      setTimeout(() => {
        const inp = document.querySelector("[data-adding-key]");
        if (inp) inp.focus();
      }, 0);
      break;
    }

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

    // ── Format ──
    case "del-format":
      data.format.splice(+ds.fi, 1);
      markDirty();
      break;

    // ── Product ──
    case "del-product-group":
      if (selectedNode?.type === "product-group") selectedNode = null;
      data.product.splice(+ds.gi, 1);
      markDirty();
      break;
    case "del-product-group-item":
      data.product[+ds.gi].items.splice(+ds.ii, 1);
      markDirty();
      break;
    case "add-product-group": {
      data.product.push({ label: "새 브랜드", items: [] });
      selectNode({ type: "product-group", gi: data.product.length - 1 });
      markDirty();
      break;
    }

    // ── Concept groups ──
    case "del-concept-group": {
      const gi = +ds.gi;
      if (
        selectedNode?.type === "concept-group" ||
        selectedNode?.type === "concept-item"
      )
        selectedNode = null;
      for (const item of data.concept.options[gi].items)
        delete data.concept.subConcepts[item];
      openConceptGroups.delete(String(gi));
      data.concept.options.splice(gi, 1);
      markDirty();
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
      markDirty();
      break;
    }
    case "del-concept-item": {
      const gi = +ds.gi;
      const ci = ds.ci;
      const idx = data.concept.options[gi].items.indexOf(ci);
      if (idx !== -1) data.concept.options[gi].items.splice(idx, 1);
      if (ci in data.concept.subConcepts) delete data.concept.subConcepts[ci];
      selectedNode = { type: "concept-group", gi };
      markDirty();
      break;
    }
    case "add-concept-group": {
      data.concept.options.push({ label: "새 그룹", items: [] });
      const newGi = data.concept.options.length - 1;
      selectNode({ type: "concept-group", gi: newGi });
      markDirty();
      break;
    }

    // ── Sub-concepts ──
    case "add-subconcept-group":
      if (!(ds.ci in data.concept.subConcepts))
        data.concept.subConcepts[ds.ci] = [];
      data.concept.subConcepts[ds.ci].push({ label: "새 그룹", items: [] });
      markDirty();
      break;
    case "del-subconcept-group":
      data.concept.subConcepts[ds.ci].splice(+ds.scg, 1);
      markDirty();
      break;
    case "del-subconcept-group-item": {
      data.concept.subConcepts[ds.ci][+ds.scg].items.splice(+ds.scgi, 1);
      markDirty();
      break;
    }
    case "confirm-add": {
      commitAdd(ds, "");
      break;
    }
  }
};

const onAppKeydown = function (e) {
  const inp = e.target;
  if (inp.dataset.editKey) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveChipEdit(inp);
    } else if (e.key === "Escape") {
      editingChip = null;
      rerender();
    }
    return;
  }
  if (inp.dataset.addingKey) {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = inp.value.trim();
      addingChip = null;
      if (v) commitAdd(inp.dataset, v);
      else rerender();
    } else if (e.key === "Escape") {
      addingChip = null;
      rerender();
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
      if (v !== "") {
        if (!(v in data.concept.subConcepts)) data.concept.subConcepts[v] = [];
        selectNode({ type: "concept-item", ci: v, gi });
      }
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

  // If the chip was left empty, delete it
  if (!v) {
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
  if (inp.dataset.editKey || inp.dataset.addingKey) {
    inp.size = Math.max(4, inp.value.length + 2);
  }
};

const onAppFocusOut = function (e) {
  const inp = e.target;
  if (inp.dataset.editKey && editingChip !== null) saveChipEdit(inp);
  if (inp.dataset.addingKey && addingChip !== null) {
    const v = inp.value.trim();
    addingChip = null;
    if (v) commitAdd(inp.dataset, v);
    else rerender();
  }
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

function Chip(text, delAction, delAttrs, opts) {
  // opts = { key, list, idx, type } — enables edit + drag; omit for plain chips
  if (!opts) {
    return h(
      "span",
      { className: "chip" },
      h("span", {}, text),
      h(
        "button",
        {
          className: "chip-del",
          type: "button",
          "data-action": delAction,
          ...delAttrs,
        },
        "×",
      ),
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
    h(
      "button",
      {
        className: "chip-del",
        type: "button",
        tabIndex: -1,
        "data-action": delAction,
        ...delAttrs,
      },
      "×",
    ),
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
      "div",
      { className: "tree-section-body" },
      ...productGroups.map(({ x, i }) =>
        TreeLeaf(
          "select-product-group",
          { "data-gi": i },
          x.label,
          selectedNode?.type === "product-group" && selectedNode.gi === i,
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
    ),

    // ── CONCEPT ──
    h("div", { className: "tree-section-header" }, "컨셉 그룹"),
    h(
      "div",
      { className: "tree-section-body" },
      ...data.concept.options.map((group, gi) => {
        const groupOpen = openConceptGroups.has(String(gi));
        const groupSelected =
          selectedNode?.type === "concept-group" && selectedNode.gi === gi;
        return h(
          "div",
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
                "div",
                { className: "tree-group-items" },
                ...group.items.map((item) => {
                  const sel =
                    selectedNode?.type === "concept-item" &&
                    selectedNode.ci === item;
                  return h(
                    "div",
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
        h(
          "button",
          {
            className: "btn-danger-sm",
            type: "button",
            "data-action": "del-product-group",
            "data-gi": gi,
          },
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
        h(
          "button",
          {
            className: "btn-danger-sm",
            type: "button",
            "data-action": "del-concept-group",
            "data-gi": gi,
          },
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
              h(
                "button",
                {
                  className: "chip-del",
                  type: "button",
                  tabIndex: -1,
                  "data-action": "del-concept-group-item",
                  "data-gi": gi,
                  "data-ii": ii,
                },
                "×",
              ),
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
        h(
          "button",
          {
            className: "btn-danger-sm",
            type: "button",
            "data-action": "del-concept-item",
            "data-ci": ci,
            "data-gi": gi,
          },
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
                    h(
                      "button",
                      {
                        className: "btn-danger-xs",
                        type: "button",
                        "data-action": "del-subconcept-group",
                        "data-ci": ci,
                        "data-scg": scg,
                      },
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

// ─── App root ─────────────────────────────────────────────────

function App() {
  return h(
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
  );
}

// ─── Download ─────────────────────────────────────────────────

function download() {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "data.json";
  a.click();
  URL.revokeObjectURL(url);
  dirty = false;
  const btn = document.getElementById("download-btn");
  btn.classList.remove("dirty");
  btn.textContent = "data.json 다운로드";
}

window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

document.getElementById("download-btn").addEventListener("click", download);

// ─── Init ─────────────────────────────────────────────────────

fetch("data.json")
  .then((r) => r.json())
  .then((d) => {
    data = d;
    rerender();
  });
