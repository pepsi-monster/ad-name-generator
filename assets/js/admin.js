// ============================================================
// ADMIN — data.json editor (two-panel: tree + editor)
// Uses framework.js (h, createRoot) loaded before this script.
// ============================================================

// ─── State ───────────────────────────────────────────────────

let data = null;
let originalData = null;
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
let bulkPrompt = null; // { active: boolean, parts: string[], label: string, dupes: Set<number> }
let dupeWarning = null; // the duplicate value string when single chip input matches an existing item
let historyOpen = false; // whether the history side panel is open
let toastMsg = null; // toast notification message string, null when hidden
let toastAction = null; // optional secondary action/history line
let toastTimer = null;
let toastHideTimer = null;
let lastActionTime = Date.now(); // time of the most recent change
const CONFIG_CACHE_KEY = "ad-gen-config-cache-v1";
const SCOPED_CONFIG_CACHE_KEY = `${CONFIG_CACHE_KEY}:${location.origin}`;
const CONFIG_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

function isValidConfigData(v) {
  return Boolean(
    v &&
      typeof v === "object" &&
      Array.isArray(v.format) &&
      Array.isArray(v.product) &&
      v.concept &&
      typeof v.concept === "object" &&
      Array.isArray(v.concept.options) &&
      v.concept.subConcepts &&
      typeof v.concept.subConcepts === "object" &&
      Number.isFinite(v.versionMax),
  );
}

function hasFreshCache(cache) {
  if (!cache) return false;
  if (!Number.isFinite(cache.cachedAt)) return false;
  return Date.now() - cache.cachedAt <= CONFIG_CACHE_MAX_AGE_MS;
}

function showToastMsg(msg, ttl = 3000, opts = {}) {
  const includeLastAction = opts.includeLastAction !== false;
  toastMsg = msg;
  if (opts.actionText !== undefined) {
    toastAction = opts.actionText;
  } else if (includeLastAction && undoStack.length > 0) {
    toastAction = String(undoStack[undoStack.length - 1].desc || "");
  } else {
    toastAction = null;
  }
  renderToastPortal();
  if (toastTimer) clearTimeout(toastTimer);
  if (toastHideTimer) clearTimeout(toastHideTimer);
  toastTimer = setTimeout(() => {
    hideToastPortal();
    toastTimer = null;
  }, ttl);
}

function getToastPortalEl() {
  let el = document.getElementById("global-toast");
  if (el) return el;
  el = document.createElement("div");
  el.id = "global-toast";
  el.className = "toast";
  document.body.appendChild(el);
  return el;
}

function renderToastPortal() {
  const el = getToastPortalEl();
  el.innerHTML = "";
  const label = document.createElement("div");
  label.className = "toast-label";
  label.textContent = toastMsg || "";
  el.appendChild(label);
  if (toastAction) {
    const action = document.createElement("div");
    action.className = "toast-action";
    appendToastActionNodes(action, String(toastAction));
    el.appendChild(action);
  }
  requestAnimationFrame(() => {
    el.classList.add("toast--visible");
  });
}

function appendToastActionNodes(container, desc) {
  const parts = String(desc || "").split("'");
  parts.forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 1) {
      const subject = document.createElement("span");
      subject.className = "toast-action-subject";
      subject.textContent = part;
      container.appendChild(subject);
      return;
    }
    const arrowParts = part.split(" → ");
    arrowParts.forEach((chunk, j) => {
      if (chunk) container.appendChild(document.createTextNode(chunk));
      if (j < arrowParts.length - 1) {
        const arrow = document.createElement("span");
        arrow.className = "toast-action-arrow";
        arrow.textContent = " → ";
        container.appendChild(arrow);
      }
    });
  });
}

function hideToastPortal() {
  toastMsg = null;
  toastAction = null;
  const el = document.getElementById("global-toast");
  if (!el) return;
  el.classList.remove("toast--visible");
  toastHideTimer = setTimeout(() => {
    const current = document.getElementById("global-toast");
    if (current) current.innerHTML = "";
    toastHideTimer = null;
  }, 220);
}

// ─── Undo ─────────────────────────────────────────────────────
const undoStack = [];
const MAX_UNDO = 50;
let serverLoadTime = Date.now();
let loadedConfigVersion = null;

function pushUndo(desc) {
  undoStack.push({ state: JSON.parse(JSON.stringify(data)), node: selectedNode ? { ...selectedNode } : null, desc, time: Date.now() });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function applyUndo() {
  if (!undoStack.length) return;
  const item = undoStack.pop();
  data = item.state;
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
  dupeWarning = null;
  bulkPrompt = null;
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
      return "태그";
  }
}

// ─── Component Labels ────────────────────────────────────────

function getLabelForType(type) {
  switch (type) {
    case "product-group-item":
      return "제품";
    case "concept-group-item":
      return "컨셉";
    case "subconcept-group-item":
      return "세부 컨셉";
    default:
      return "태그";
  }
}

// ─── Root ────────────────────────────────────────────────────

let root = null;

function ensureRoot() {
  if (root) return root;
  const container = document.getElementById("admin-main");
  if (!container) return null;
  // Our renderer appends into existing DOM; clear loading markup first.
  container.innerHTML = "";
  root = createRoot(container);
  return root;
}

function rerender() {
  if (!data) return;
  const currentRoot = ensureRoot();
  if (!currentRoot) return;
  currentRoot.render(App());
}

function markDirty() {
  const isChanged = JSON.stringify(data) !== JSON.stringify(originalData);
  dirty = isChanged;
  lastActionTime = Date.now();

  const submitBtn = document.getElementById("submit-btn");
  if (isChanged) {
    document.title = "* 태그 관리 — APPSILON";
    submitBtn?.classList.add("dirty");
    localStorage.setItem("ad-name-generator-draft", JSON.stringify({ version: 2, data, undoStack }));
  } else {
    document.title = "태그 관리 — APPSILON";
    submitBtn?.classList.remove("dirty");
    localStorage.removeItem("ad-name-generator-draft");
  }

  rerender();
}

function selectNode(node) {
  selectedNode = node;
  rerender();
}

// ─── Delete execution (called after modal confirms) ──────────

function executeDelete(action, ds) {
  const subject = getDeleteSubject(action, ds);
  const typeLabel = getDeleteTypeLabel(action);

  let prefix = "";
  if (action === "del-product-group-item") {
    const pLabel = data.product[+ds.gi]?.label;
    if (pLabel) prefix = `'${pLabel}'에서 `;
  } else if (action === "del-concept-group-item") {
    const cLabel = data.concept.options[+ds.gi]?.label;
    if (cLabel) prefix = `'${cLabel}'에서 `;
  } else if (action === "del-subconcept-group-item") {
    const scgLabel = data.concept.subConcepts[ds.ci]?.[+ds.scg]?.label;
    if (ds.ci && scgLabel) prefix = `'${ds.ci}' > '${scgLabel}'에서 `;
  } else if (action === "del-subconcept-group") {
    if (ds.ci) prefix = `'${ds.ci}'에서 `;
  }

  if (subject === "") {
    if (undoStack.length > 0) undoStack.pop();
  } else {
    pushUndo(`${prefix}${typeLabel} '${subject}' 삭제`);
  }
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

const getUniqueName = (baseName, existingNames) => {
  let name = baseName;
  let counter = 1;
  while (existingNames.includes(name)) {
    name = `${baseName} ${counter}`;
    counter++;
  }
  return name;
};

const onAppClick = function (e) {
  let target = e.target;
  if (target && target.nodeType === 3) target = target.parentNode;

  // Backdrop click dismisses modals
  if (confirmPending && !target.closest(".modal-dialog")) {
    confirmPending = null;
    rerender();
    return;
  }
  if (submitPending && !submitting && !target.closest(".modal-dialog")) {
    submitPending = false;
    submitError = null;
    rerender();
    return;
  }

  // Close history panel if clicking outside of it, and not interacting with a modal
  if (historyOpen && !target.closest(".history-panel") && !target.closest('[data-action="toggle-history"]') && !target.closest(".modal-dialog")) {
    historyOpen = false;
    rerender();
    return;
  }

  const btn = target.closest("[data-action]");
  if (!btn) return;
  const ds = btn.dataset;

  // First click on any del-* action opens the modal instead of executing
  if (ds.action.startsWith("del-")) {
    const wasEditing = editingChip !== null;
    editingChip = null;
    bulkPrompt = null;
    dupeWarning = null;
    if (wasEditing || ["del-product-group-item", "del-concept-group-item", "del-subconcept-group-item"].includes(ds.action)) {
      // Chip was being edited, or it's just a single tag item — intent is clear or easy to recover, skip confirmation
      executeDelete(ds.action, { ...ds });
    } else {
      // Bigger deletions (Groups, Brands) still need confirmation
      confirmPending = { action: ds.action, ds: { ...ds } };
      rerender();
    }
    return;
  }

  switch (ds.action) {

    case "submit-data":
      if (!dirty) return;
      submitPending = true;
      submitError = null;
      rerender();
      break;

    case "confirm-bulk-add": {
      bulkPrompt = null;
      const editingInp = document.querySelector(
        `[data-edit-key="${editingChip}"]`,
      );
      if (editingInp) saveChipEdit(editingInp, true);
      break;
    }

    case "edit-chip":
      editingChip = ds.chipKey;
      dupeWarning = null;
      bulkPrompt = null;
      rerender();
      setTimeout(() => {
        const inp = document.querySelector("[data-edit-key]");
        if (inp) {
          inp.focus();
          inp.select();
        }
      }, 0);
      break;

    case "go-home":
      selectNode(null);
      break;

    case "toggle-history":
      historyOpen = !historyOpen;
      rerender();
      break;

    case "restore-history":
      confirmPending = { action: "restore-history", ds: { ...ds } };
      rerender();
      break;

    case "confirm-restore-history": {
      const targetIdx = +ds.idx;
      if (Number.isNaN(targetIdx) || targetIdx < 0 || targetIdx > undoStack.length) {
        confirmPending = null;
        rerender();
        break;
      }
      if (targetIdx === 0) {
        // Restore to original server data (phantom base)
        data = JSON.parse(JSON.stringify(originalData));
        undoStack.length = 0;
        serverLoadTime = Date.now();
      } else {
        // Offset by 1 since phantom base is idx=0
        const target = undoStack[targetIdx - 1];
        undoStack.length = targetIdx - 1;
        data = target.state;
        selectedNode = target.node ?? null;
      }

      // Validate selectedNode
      if (selectedNode) {
        const n = selectedNode;
        if (n.type === "product-group" && !data.product[n.gi]) selectedNode = null;
        else if (n.type === "concept-group" && !data.concept.options[n.gi]) selectedNode = null;
        else if (n.type === "concept-item" && !data.concept.options[n.gi]?.items.includes(n.ci)) selectedNode = null;
      }
      dupeWarning = null;
      bulkPrompt = null;
      confirmPending = null;
      historyOpen = false;
      markDirty();
      break;
    }

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
      const existing = data.product.map(p => p.label);
      const newName = getUniqueName("새 브랜드", existing);
      pushUndo(`브랜드 '${newName}' 추가`);
      data.product.push({ label: newName, items: [] });
      selectNode({ type: "product-group", gi: data.product.length - 1 });
      markDirty();
      break;
    }

    // ── Concept groups ──
    case "add-concept-group": {
      const existing = data.concept.options.map(c => c.label);
      const newName = getUniqueName("새 그룹", existing);
      pushUndo(`컨셉 그룹 '${newName}' 추가`);
      data.concept.options.push({ label: newName, items: [] });
      const newGi = data.concept.options.length - 1;
      selectNode({ type: "concept-group", gi: newGi });
      markDirty();
      break;
    }

    // ── Sub-concepts ──
    case "add-subconcept-group": {
      if (!(ds.ci in data.concept.subConcepts)) {
        data.concept.subConcepts[ds.ci] = [];
      }
      const existing = data.concept.subConcepts[ds.ci].map(scg => scg.label);
      const newName = getUniqueName("새 그룹", existing);
      pushUndo(`'${ds.ci}'에 세부 컨셉 그룹 '${newName}' 추가`);
      data.concept.subConcepts[ds.ci].push({ label: newName, items: [] });
      markDirty();
      break;
    }

    case "cancel-modal":
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

const onAppKeyDown = function (e) {
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
      if (bulkPrompt && bulkPrompt.active) {
        if (bulkPrompt.dupes.size > 0) {
          // Has dupes — flash to signal "fix these first"
          setTimeout(() => {
            const i = document.querySelector("[data-edit-key]");
            if (i) flashError(i);
          }, 0);
        } else {
          bulkPrompt = null;
          saveChipEdit(inp, true);
        }
      } else {
        saveChipEdit(inp, false);
      }
    } else if (e.key === "Escape") {
      // If this was a newly-added chip (editOrig === ""), delete the empty entry
      if (inp.dataset.editOrig === "") {
        inp.value = "";
        saveChipEdit(inp, false);
      } else {
        editingChip = null;
        bulkPrompt = null;
        dupeWarning = null;
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
  switch (ds.label) {
    case "product-group":
      pushUndo(`브랜드명 변경 '${ds.orig}' → '${v}'`);
      data.product[+ds.gi].label = v;
      break;
    case "concept-group":
      pushUndo(`컨셉 그룹명 변경 '${ds.orig}' → '${v}'`);
      data.concept.options[+ds.gi].label = v;
      break;
    case "subconcept-group":
      pushUndo(`세부 컨셉 그룹명 변경 '${ds.orig}' → '${v}'`);
      data.concept.subConcepts[ds.ci][+ds.scg].label = v;
      break;
    case "concept-item": {
      pushUndo(`컨셉명 변경 '${ds.orig}' → '${v}'`);
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
  // If v is empty string (from the add button), we need to allow one placeholder chip to start editing
  let parts;
  if (v === "") {
    parts = [""];
  } else {
    parts = v
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
  }

  const typeLabel = getLabelForType(ds.add);
  let prefix = "";
  if (ds.add === "product-group-item") {
    const pLabel = data.product[+ds.gi]?.label;
    if (pLabel) prefix = `'${pLabel}'에 `;
  } else if (ds.add === "concept-group-item") {
    const cLabel = data.concept.options[+ds.gi]?.label;
    if (cLabel) prefix = `'${cLabel}'에 `;
  } else if (ds.add === "subconcept-group-item") {
    const scgLabel = data.concept.subConcepts[ds.ci]?.[+ds.scg]?.label;
    if (ds.ci && scgLabel) prefix = `'${ds.ci}' > '${scgLabel}'에 `;
  }
  let initialDesc = "";
  if (parts.length > 1) {
    initialDesc = `${prefix}'${typeLabel}' ${parts.length}개 추가`;
  } else if (parts[0] === "") {
    initialDesc = `${prefix}새 '${typeLabel}' 작성 중...`;
  } else {
    initialDesc = `${prefix}'${typeLabel}' 추가`;
  }
  pushUndo(initialDesc);
  let newKey = null;

  switch (ds.add) {
    case "product-group-item": {
      const arr = data.product[+ds.gi].items;
      for (const part of parts) {
        if (!arr.includes(part)) arr.push(part);
      }
      if (parts.length === 1 && arr.includes(parts[0])) {
        newKey = `p:${ds.gi}:${arr.length - 1}`;
      }
      break;
    }
    case "concept-group-item": {
      const gi = +ds.gi;
      const arr = data.concept.options[gi].items;
      for (const part of parts) {
        if (!arr.includes(part)) arr.push(part);
      }
      if (parts.length === 1 && arr.includes(parts[0])) {
        newKey = `ci:${ds.gi}:${arr.length - 1}`;
      }
      break;
    }
    case "subconcept-group-item": {
      const arr = data.concept.subConcepts[ds.ci][+ds.scg].items;
      for (const part of parts) {
        if (!arr.includes(part)) arr.push(part);
      }
      if (parts.length === 1 && arr.includes(parts[0])) {
        newKey = `s:${ds.ci}:${ds.scg}:${arr.length - 1}`;
      }
      break;
    }
  }

  // Only auto-focus into edit mode if they added a single item
  if (newKey) {
    editingChip = newKey;
    dupeWarning = null;
    rerender();
    setTimeout(() => {
      const inp = document.querySelector("[data-edit-key]");
      if (inp) {
        inp.focus();
        inp.select();
      }
    }, 0);
  } else {
    markDirty();
  }
}

function saveChipEdit(inp, allowBulk = true) {
  const { editType, editOrig, editKey } = inp.dataset;
  editingChip = null;
  dupeWarning = null;

  const parts = inp.value
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const finalParts = allowBulk ? parts : parts.length > 0 ? [parts[0]] : [];

  // Empty → delete chip
  if (parts.length === 0) {
    if (editOrig !== "") {
      pushUndo(`${getLabelForType(editType)} '${editOrig}' 삭제`);
    } else if (undoStack.length > 0) {
      undoStack.pop(); // Revert the empty chip snapshot from commitAdd
    }
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

  // No-change → exit edit mode
  if (parts.length === 1 && parts[0] === editOrig && editOrig !== "") {
    rerender();
    return;
  }

  // Duplicate on parts[0] → stay in edit mode with warning
  if (parts.length > 0 && isDuplicateChip(editType, parts[0], inp.dataset)) {
    editingChip = editKey;
    dupeWarning = parts[0];
    rerender();
    setTimeout(() => {
      const newInp = document.querySelector("[data-edit-key]");
      if (newInp) flashError(newInp);
    }, 0);
    return;
  }

  // New chips already have a snapshot from commitAdd; update its description now that we know the final text
  if (editOrig !== "") {
    pushUndo(`${getLabelForType(editType)}명 변경 '${editOrig}' → '${parts[0]}'`);
  } else if (undoStack.length > 0) {
    const typeLabel = getLabelForType(editType);
    let prefix = "";
    if (editType === "product-group-item") {
      const pLabel = data.product[+inp.dataset.gi]?.label;
      if (pLabel) prefix = `'${pLabel}'에 `;
    } else if (editType === "concept-group-item") {
      const cLabel = data.concept.options[+inp.dataset.gi]?.label;
      if (cLabel) prefix = `'${cLabel}'에 `;
    } else if (editType === "subconcept-group-item") {
      const scgLabel = data.concept.subConcepts[inp.dataset.ci]?.[+inp.dataset.scg]?.label;
      if (inp.dataset.ci && scgLabel) prefix = `'${inp.dataset.ci}' > '${scgLabel}'에 `;
    }
    undoStack[undoStack.length - 1].desc = parts.length > 1
      ? `${prefix}'${typeLabel}' ${parts.length}개 추가`
      : `${prefix}'${typeLabel}' '${parts[0]}' 추가`;
    undoStack[undoStack.length - 1].time = Date.now();
  }

  // Save primary value + inject subsequent valid parts
  switch (editType) {
    case "product-group-item": {
      const arr = data.product[+inp.dataset.gi].items;
      arr[+inp.dataset.ii] = parts[0];
      for (let i = 1; i < parts.length; i++) {
        if (!arr.includes(parts[i]))
          arr.splice(+inp.dataset.ii + i, 0, parts[i]);
      }
      break;
    }
    case "concept-group-item": {
      const arr = data.concept.options[+inp.dataset.gi].items;
      arr[+inp.dataset.ii] = parts[0];
      if (editOrig && editOrig in data.concept.subConcepts) {
        data.concept.subConcepts[parts[0]] = data.concept.subConcepts[editOrig];
        delete data.concept.subConcepts[editOrig];
      } else if (!(parts[0] in data.concept.subConcepts)) {
        data.concept.subConcepts[parts[0]] = [];
      }
      for (let i = 1; i < parts.length; i++) {
        if (!arr.includes(parts[i])) {
          arr.splice(+inp.dataset.ii + i, 0, parts[i]);
          if (!(parts[i] in data.concept.subConcepts))
            data.concept.subConcepts[parts[i]] = [];
        }
      }
      break;
    }
    case "subconcept-group-item": {
      const arr =
        data.concept.subConcepts[inp.dataset.ci][+inp.dataset.scg].items;
      arr[+inp.dataset.scgi] = parts[0];
      for (let i = 1; i < finalParts.length; i++) {
        if (!arr.includes(finalParts[i]))
          arr.splice(+inp.dataset.scgi + i, 0, finalParts[i]);
      }
      break;
    }
  }
  bulkPrompt = null;
  markDirty();
}

const onAppInput = function (e) {
  const inp = e.target;
  if (inp.dataset.editKey) {
    inp.size = Math.max(4, inp.value.length + 2);
    const parts = inp.value
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    let changed = false;
    if (parts.length > 1) {
      const dupes = new Set(
        parts.flatMap((p, i) =>
          isDuplicateChip(inp.dataset.editType, p, inp.dataset) ? [i] : [],
        ),
      );
      const partsKey = parts.join("\x00");
      const dupesKey = [...dupes].join(",");
      if (
        !bulkPrompt ||
        bulkPrompt.partsKey !== partsKey ||
        [...bulkPrompt.dupes].join(",") !== dupesKey
      ) {
        bulkPrompt = {
          active: true,
          parts,
          partsKey,
          label: getLabelForType(inp.dataset.editType),
          dupes,
        };
        changed = true;
      }
      if (dupeWarning !== null) {
        dupeWarning = null;
        changed = true;
      }
    } else {
      if (bulkPrompt !== null) {
        bulkPrompt = null;
        changed = true;
      }
      const newDupe =
        parts.length === 1 &&
          isDuplicateChip(inp.dataset.editType, parts[0], inp.dataset)
          ? parts[0]
          : null;
      if (newDupe !== dupeWarning) {
        dupeWarning = newDupe;
        changed = true;
      }
    }
    if (changed) rerender();
  }
};

const onAppFocusOut = function (e) {
  const inp = e.target;
  // If we have an active bulk prompt, clicking IT will cause a focusOut on the input.
  // We want to give the click handler a chance to fire instead of immediately saving/cancelling.
  if (inp.dataset.editKey && editingChip !== null) {
    if (bulkPrompt && bulkPrompt.active) {
      // Defer the save to let the click action on the prompt register first
      setTimeout(() => {
        if (editingChip === inp.dataset.editKey) {
          bulkPrompt = null;
          saveChipEdit(inp, false); // false = don't force bulk, just save first part
        }
      }, 150);
    } else {
      saveChipEdit(inp, true);
    }
  }
};

const onAppDragStart = function (e) {
  let target = e.target;
  if (target && target.nodeType === 3) target = target.parentNode;
  const chip = target.closest("[data-chip-key]");
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
  let target = e.target;
  if (target && target.nodeType === 3) target = target.parentNode;
  const chip = target.closest("[data-chip-key]");
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
  let target = e.target;
  if (target && target.nodeType === 3) target = target.parentNode;
  const srcIdx = dragSrc.idx;
  const tgtIdx = dragOverIdx;
  const srcType = dragSrc.type;
  let items;
  switch (srcType) {
    case "product-group":
      items = data.product;
      break;
    case "concept-group":
      items = data.concept.options;
      break;
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
    let typeName = "항목";
    if (items === data.product) typeName = "브랜드";
    else if (items === data.concept.options) typeName = "컨셉 그룹";
    else if (srcType === "product-group-item") typeName = "제품";
    else if (srcType === "concept-group-item") typeName = "컨셉";
    else if (srcType === "subconcept-group-item") typeName = "세부 컨셉";
    else if (srcType === "subconcept-group") typeName = "세부 컨셉 그룹";

    pushUndo(`${typeName} 순서 변경`);
    const [moved] = items.splice(srcIdx, 1);
    const spliceIdx = tgtIdx;
    items.splice(spliceIdx, 0, moved);

    // If we reordered concept groups, the openConceptGroups indexes must be updated
    if (items === data.concept.options) {
      const oldKeys = Array.from(openConceptGroups);
      openConceptGroups.clear();
      oldKeys.forEach((key) => {
        const k = Number(key);
        if (k === srcIdx) {
          openConceptGroups.add(String(spliceIdx));
        } else if (srcIdx < k && k <= spliceIdx) {
          openConceptGroups.add(String(k - 1));
        } else if (spliceIdx <= k && k < srcIdx) {
          openConceptGroups.add(String(k + 1));
        } else {
          openConceptGroups.add(key);
        }
      });

      if (selectedNode?.type === "concept-group" || selectedNode?.type === "concept-item") {
        if (selectedNode.gi === srcIdx) {
          selectedNode.gi = spliceIdx;
        } else if (srcIdx < selectedNode.gi && selectedNode.gi <= spliceIdx) {
          selectedNode.gi -= 1;
        } else if (spliceIdx <= selectedNode.gi && selectedNode.gi < srcIdx) {
          selectedNode.gi += 1;
        }
      }
    } else if (items === data.product) {
      if (selectedNode?.type === "product-group") {
        if (selectedNode.gi === srcIdx) {
          selectedNode.gi = spliceIdx;
        } else if (srcIdx < selectedNode.gi && selectedNode.gi <= spliceIdx) {
          selectedNode.gi -= 1;
        } else if (spliceIdx <= selectedNode.gi && selectedNode.gi < srcIdx) {
          selectedNode.gi += 1;
        }
      }
    }

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
  const { key, list, idx, type, className = "chip", extra } = opts;
  const isEditing = editingChip === key;
  const isDragging = dragSrc?.key === key;
  const isDragOver =
    !isDragging && dragOverIdx === idx && dragSrc?.list === list;
  const isVertical = false; // Chips and concept items are all laid out horizontally
  const dragDirClass = isDragOver
    ? idx > dragSrc.idx
      ? " drag-right"
      : " drag-left"
    : "";

  const showBulkPrompt = isEditing && bulkPrompt && bulkPrompt.active;
  const showDupeWarning = isEditing && dupeWarning !== null;

  return h(
    "span",
    {
      className:
        className +
        (isDragging ? " chip-dragging" : "") +
        (isDragOver ? " chip-drag-over" : "") +
        (isEditing ? " chip-editing" : "") +
        dragDirClass,
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
    extra || null,
    ChipDelBtn(delAction, delAttrs),
    showBulkPrompt && bulkPrompt.dupes.size === 0
      ? h(
        "button",
        {
          type: "button",
          className: "bulk-prompt-dropdown",
          onMousedown: (e) => {
            e.preventDefault();
            bulkPrompt = null;
            const editingInp = document.querySelector(
              `[data-edit-key="${key}"]`,
            );
            if (editingInp) saveChipEdit(editingInp, true);
          },
        },
        h("span", { className: "material-symbols-rounded" }, "library_add"),
        `${new Set(bulkPrompt.parts).size}개 ${bulkPrompt.label}을 추가할까요?`,
      )
      : showBulkPrompt && bulkPrompt.dupes.size > 0
        ? h(
          "div",
          { className: "bulk-prompt-dropdown is-warning" },
          h("span", { className: "material-symbols-rounded" }, "warning"),
          `이미 있는 ${bulkPrompt.label}이에요`,
          h(
            "span",
            { className: "bulk-prompt-parts" },
            ...bulkPrompt.parts
              .filter((_, i) => bulkPrompt.dupes.has(i))
              .flatMap((p, i) => [
                ...(i > 0
                  ? [h("span", { className: "bulk-prompt-sep" }, "·")]
                  : []),
                h("span", { className: "bulk-prompt-part is-dupe" }, p),
              ]),
          ),
        )
        : showDupeWarning
          ? h(
            "div",
            { className: "bulk-prompt-dropdown is-warning" },
            h("span", { className: "material-symbols-rounded" }, "warning"),
            `이미 있는 ${getLabelForType(type)}이에요`,
          )
          : null,
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
    h(
      "div",
      { className: "tree-panel-inner" },

      // ── HOME ──
      h("div", { className: "tree-section-header" }, "소개"),
      h(
        "ul",
        { className: "tree-section-body" },
        h(
          "li",
          {},
          TreeLeaf(
            "go-home",
            {},
            "시작하기",
            selectedNode === null
          ),
        ),
      ),

      // ── PRODUCT ──
      h("div", { className: "tree-section-header" }, "브랜드"),
      h(
        "ul",
        { className: "tree-section-body" },
        ...productGroups.map(({ x, i }) => {
          const key = `pg:${i}`;
          const isDragging = dragSrc?.key === key;
          const isDragOver = !isDragging && dragOverIdx === i && dragSrc?.list === "product-groups";
          const dragDirClass = isDragOver ? (i > dragSrc.idx ? " drag-down" : " drag-up") : "";
          return h(
            "li",
            {
              className: (isDragging ? "chip-dragging" : "") + (isDragOver ? " group-drag-over" : "") + dragDirClass,
              draggable: true,
              "data-chip-key": key,
              "data-chip-list": "product-groups",
              "data-chip-idx": i,
              "data-chip-type": "product-group",
              "data-gi": i
            },
            TreeLeaf(
              "select-product-group",
              { "data-gi": i },
              x.label,
              selectedNode?.type === "product-group" && selectedNode.gi === i
            ),
          );
        }),
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
          const key = `cg:${gi}`;
          const isDragging = dragSrc?.key === key;
          const isDragOver = !isDragging && dragOverIdx === gi && dragSrc?.list === "concept-groups";
          const dragDirClass = isDragOver ? (gi > dragSrc.idx ? " drag-down" : " drag-up") : "";
          return h(
            "li",
            {
              className: "tree-group-wrap" + (isDragging ? " chip-dragging" : "") + (isDragOver ? " group-drag-over" : "") + dragDirClass,
              draggable: true,
              "data-chip-key": key,
              "data-chip-list": "concept-groups",
              "data-chip-idx": gi,
              "data-chip-type": "concept-group",
              "data-gi": gi
            },
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
    ),
  );
}

// ─── Editor panel ─────────────────────────────────────────────

function EditorPanel() {
  if (!selectedNode) {
    return h(
      "div",
      { className: "editor-empty" },
      h(
        "section",
        { className: "onboarding-shell" },
        h("p", { className: "onboarding-eyebrow" }, "태그 관리 가이드"),
        h("h2", { className: "onboarding-title" }, "소재명 품질을 높이는 태그 관리"),
        h(
          "p",
          { className: "onboarding-lead" },
          "실무에서 바로 쓰는 순서와 규칙만 간단히 정리했어요.",
        ),
        h(
          "div",
          { className: "onboarding-grid" },
          h(
            "article",
            { className: "onboarding-card onboarding-card--apply" },
            h(
              "h3",
              { className: "onboarding-card-title" },
              h("span", { className: "material-symbols-rounded" }, "info"),
              "적용 범위와 저장 방식",
            ),
            h(
              "ul",
              { className: "onboarding-list" },
              h("li", null, "작업 내역은 자동으로 로컬 임시 저장 상태로 보관돼요."),
              h("li", null, "상단 저장 버튼으로 서버에 저장해야 생성기에 반영돼요."),
              h("li", null, "저장 버튼은 서버 원본과 다른 변경이 있을 때만 활성화돼요."),
              h("li", null, "우상단의 작업 내역 버튼에서 저장 전 변경 사항을 확인할 수 있어요."),
            ),
          ),
          h(
            "article",
            { className: "onboarding-card onboarding-card--flow" },
            h(
              "h3",
              { className: "onboarding-card-title" },
              h("span", { className: "material-symbols-rounded" }, "checklist"),
              "권장 작업 순서",
            ),
            h(
              "ol",
              { className: "onboarding-list" },
              h(
                "li",
                null,
                h("strong", null, "브랜드"),
                "를 추가하고 하위 ",
                h("strong", null, "제품"),
                "을 입력해요.",
              ),
              h(
                "li",
                null,
                h("strong", null, "컨셉 그룹"),
                "을 만들고 컨셉 태그를 등록해요.",
              ),
              h(
                "li",
                null,
                "필요한 컨셉에 ",
                h("strong", null, "세부 컨셉 그룹"),
                "과 세부 컨셉을 연결해요.",
              ),
              h(
                "li",
                null,
                "순서를 정리한 뒤 상단 ",
                h("strong", null, "저장"),
                "으로 반영해요.",
              ),
            ),
          ),
          h(
            "article",
            { className: "onboarding-card onboarding-card--tips" },
            h(
              "h3",
              { className: "onboarding-card-title" },
              h("span", { className: "material-symbols-rounded" }, "tips_and_updates"),
              "빠른 입력 팁",
            ),
            h(
              "ul",
              { className: "onboarding-list" },
              h(
                "li",
                null,
                h("code", null, "태그1;태그2;태그3"),
                " 형태로 입력하면 여러 항목을 한 번에 추가할 수 있어요.",
              ),
              h(
                "li",
                null,
                "칩을 드래그해 노출 순서를 바로 정리할 수 있어요.",
              ),
              h(
                "li",
                null,
                h("strong", null, "Cmd/Ctrl + Z"),
                " 로 최근 변경을 되돌릴 수 있어요.",
              ),
              h(
                "li",
                null,
                "오른쪽 작업 내역에서 이전 상태로 복원할 수 있어요.",
              ),
              h(
                "li",
                null,
                "태그명 예시: ",
                h("code", null, "보습"),
                ", ",
                h("code", null, "성분소개"),
                ", ",
                h("code", null, "할인율"),
              ),
            ),
          ),
          h(
            "article",
            { className: "onboarding-card onboarding-card--rules" },
            h(
              "h3",
              { className: "onboarding-card-title" },
              h("span", { className: "material-symbols-rounded" }, "rule"),
              "운영 권장 규칙",
            ),
            h(
              "ul",
              { className: "onboarding-list" },
              h("li", null, "태그는 짧고 중복 없이 유지해요."),
              h("li", null, "의미가 겹치는 태그는 하나로 통일해요."),
              h("li", null, "같은 레벨에서는 동일한 태그명을 중복 생성하지 않아요."),
              h("li", null, "브랜드/컨셉 분류 기준은 팀 내에서 고정해요."),
              h("li", null, "저장 전 작업 내역으로 변경 범위를 확인해요."),
            ),
          ),
        ),
        h(
          "p",
          { className: "onboarding-footnote" },
          "왼쪽 트리에서 항목을 선택하면 상세 편집 화면으로 이동해요.",
        ),
      ),
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
      { className: "editor-header-group" },
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
        "브랜드별로 홍보할 제품을 입력해요. 소재명의 두 번째 자리에 들어가는 태그예요.",
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
          "드래그해 순서를 바꾸고, 클릭해 이름을 수정할 수 있어요.",
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
      { className: "editor-header-group" },
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
        "컨셉은 소재 분석의 핵심 인덱스예요. ",
        h("span", { className: "text-highlight" }, "컨셉"),
        " 그리고 ",
        h("span", { className: "text-highlight" }, "세부 컨셉"),
        "의 2단계로 나누어 분석할 수 있도록 구성해요. ",
        h("span", { className: "text-highlight" }, "컨셉 그룹"),
        "과 ",
        h("span", { className: "text-highlight" }, "세부 컨셉 그룹"),
        " 은 편의를 위한 구분이며 실제 소재명에는 적용되지 않아요.",
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
          "드래그해 순서를 바꾸고, 세부 배지를 클릭하면 세부 컨셉 편집 화면으로 이동해요.",
        ),
        h(
          "div",
          { className: "chip-wrap" },
          ...group.items.map((item, ii) => {
            const hasSub = data.concept.subConcepts[item]?.length > 0;
            return Chip(
              item,
              "del-concept-group-item",
              { "data-gi": gi, "data-ii": ii },
              {
                key: `ci:${gi}:${ii}`,
                list: `ci:${gi}`,
                idx: ii,
                type: "concept-group-item",
                className: "concept-item-row",
                extra: hasSub
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
              },
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
      { className: "editor-header-group" },
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
        "세부 컨셉 그룹과 하위 세부 컨셉을 자유롭게 설정해 보세요.",
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
              const dragDirClass = sgDragOver ? (scg > dragSrc.idx ? " drag-down" : " drag-up") : "";
              return h(
                "div",
                {
                  className:
                    "group-box" +
                    (sgDragging ? " chip-dragging" : "") +
                    (sgDragOver ? " group-drag-over" : "") +
                    dragDirClass,
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
                    "세부 컨셉 그룹 삭제",
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
  const confirmAttrs = dsToAttrs(ds);

  let title, bodyText, confirmLabel, confirmClass, confirmAction;

  if (action === "restore-history") {
    title = "선택한 시점으로 되돌릴까요?";
    bodyText = [
      "선택한 시점으로 전체 상태를 복구해요.",
      h("br"),
      "이후에 작업한 내역은 ",
      h("strong", { style: "font-weight: var(--font-semibold); color: var(--text)" }, "모두 삭제돼요")
    ];
    confirmLabel = "되돌리기";
    confirmClass = "modal-confirm"; // Change from primary to danger
    confirmAction = "confirm-restore-history";
  } else {
    // Delete branch
    const subject = getDeleteSubject(action, ds);
    const typeLabel = getDeleteTypeLabel(action);
    title = "정말 삭제할까요?";
    bodyText = [
      subject ? h("span", { className: "modal-subject" }, subject) : `이 ${typeLabel}`,
      subject ? ` ${typeLabel}을(를)` : "을(를)",
      " 삭제돼요"
    ];
    confirmLabel = "삭제";
    confirmClass = "modal-confirm";
    confirmAction = "confirm-delete";
  }

  return h(
    "div",
    { className: "modal-overlay" },
    h(
      "div",
      { className: "modal-dialog" },
      h("h2", { className: "modal-title" }, title),
      h(
        "p",
        { className: "modal-body" },
        ...bodyText
      ),
      h(
        "div",
        { className: "modal-actions" },
        h(
          "button",
          {
            type: "button",
            className: "modal-cancel",
            "data-action": "cancel-modal",
          },
          "취소",
        ),
        h(
          "button",
          {
            type: "button",
            className: confirmClass,
            "data-action": confirmAction,
            ...confirmAttrs,
          },
          confirmLabel,
        ),
      ),
    ),
  );
}

// ─── Draft restore modal ──────────────────────────────────────

// ─── Submit confirmation modal ────────────────────────────────

function SubmitModal() {
  return h(
    "div",
    { className: "modal-overlay" },
    h(
      "div",
      { className: "modal-dialog" },
      h("h2", { className: "modal-title" }, "변경 내용을 저장할까요?"),
      h(
        "p",
        { className: "modal-body" },
        submitting
          ? "서버에 저장하는 중이에요..."
          : submitError
            ? submitError
            : "변경 내용을 서버에 저장할까요?",
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
          submitting ? "저장 중..." : "저장",
        ),
      ),
    ),
  );
}

// ─── History Panel ────────────────────────────────────────────

function formatHistoryDesc(desc) {
  if (typeof desc !== "string") return [desc];
  const parts = desc.split("'");
  const tokens = [];
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      tokens.push(h("span", { className: "history-item-subject" }, part));
    } else {
      const subParts = part.split(" → ");
      subParts.forEach((sp, j) => {
        if (sp !== "") tokens.push(sp);
        if (j < subParts.length - 1) {
          tokens.push(
            h("span", {
              className: "material-symbols-rounded",
              style: "font-size: 1.25em; vertical-align: -0.22em; margin: 0 4px; color: var(--text-muted);"
            }, "arrow_right_alt")
          );
        }
      });
    }
  });
  return tokens;
}

function HistoryPanel() {
  const steps = [];
  // Always show phantom base entry
  steps.push({
    desc: "서버에서 데이터 불러오기",
    time: serverLoadTime,
    idx: 0,
    isCurrent: undoStack.length === 0
  });

  // User action entries
  for (let i = 0; i < undoStack.length; i++) {
    steps.push({
      desc: undoStack[i].desc,
      time: i === undoStack.length - 1 ? lastActionTime : undoStack[i + 1]?.time ?? lastActionTime,
      idx: i + 1,
      isCurrent: i === undoStack.length - 1
    });
  }

  const reversedSteps = steps.reverse();

  return h(
    "div",
    { className: "history-panel" + (historyOpen ? " open" : "") },
    h(
      "div",
      { className: "history-header" },
      h("h3", {}, "작업 내역"),
      h(
        "button",
        {
          className: "history-close-btn material-symbols-rounded",
          type: "button",
          "data-action": "toggle-history",
        },
        "close",
      ),
    ),
    h(
      "div",
      { className: "history-body" },
      ...reversedSteps.map(({ desc, time, idx, isCurrent }) => {
        const d = new Date(time);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        const timeStr = `${yyyy}-${mm}-${dd} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
        return h(
          "button",
          {
            className: "history-item" + (isCurrent ? " current" : ""),
            type: "button",
            "data-action": "restore-history",
            "data-idx": idx,
            disabled: isCurrent,
          },
          h(
            "div",
            { className: "history-item-header" },
            h("span", { className: "history-item-time" }, timeStr),
            isCurrent ? h("span", { className: "history-item-badge" }, "현재") : null
          ),
          h("div", { className: "history-item-desc" }, ...formatHistoryDesc(desc)),
        );
      }),
      undoStack.length > 0
        ? h("div", { className: "history-hint" }, "항목을 클릭하면 해당 시점으로 돌아가요.")
        : null
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
        onKeyDown: onAppKeyDown,
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
      HistoryPanel(),
      confirmPending ? Modal() : null,
      submitPending ? SubmitModal() : null,
    ),
    Footer(),
  );
}

// ─── Submit ───────────────────────────────────────────────────

async function submitData() {
  if (submitting) return;
  submitting = true;
  submitError = null;
  rerender();
  try {
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, baseVersion: loadedConfigVersion }),
    });
    if (!res.ok) {
      let msg = `서버 오류 (${res.status})`;
      try {
        const payload = await res.json();
        if (payload?.error) msg = payload.error;
      } catch (e) {
        // ignore parse error and keep generic message
      }
      if (res.status === 409) {
        throw new Error("다른 곳에서 먼저 저장됐어요. 새로고침 후 다시 저장해 주세요.");
      }
      throw new Error(msg);
    }

    const saved = await res.json();
    loadedConfigVersion = saved?.version ?? loadedConfigVersion;
    originalData = JSON.parse(JSON.stringify(data));
    dirty = false;
    submitPending = false;
    submitting = false;
    document.getElementById("submit-btn")?.classList.remove("dirty");
    localStorage.removeItem("ad-name-generator-draft");
    serverLoadTime = Date.now();
    try {
      writeConfigCache({
        version: saved?.version ?? null,
        updatedAt: saved?.updatedAt ?? null,
        data,
        etag: res.headers.get("ETag") || null,
      });
    } catch (e) {
      // Ignore localStorage write errors.
    }
    showToastMsg("서버에 저장을 완료했어요!", 3000, {
      includeLastAction: false,
    });
    rerender();
  } catch (err) {
    submitError = err.message || "저장에 실패했어요. 다시 시도해주세요.";
    submitting = false;
    rerender();
  }
}

// ─── Key Bindings ─────────────────────────────────────────────

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

document.addEventListener("click", onAppClick);

const adminMainEl = document.getElementById("admin-main");
const bootstrapCache = readConfigCache();
if (adminMainEl && !hasFreshCache(bootstrapCache)) {
  adminMainEl.innerHTML = `
    <div class="app-loading">
      <div class="app-loading-card">
        <div class="app-loading-spinner" aria-hidden="true"></div>
        <h2 class="app-loading-title">태그 데이터를 불러오고 있어요</h2>
        <p class="app-loading-copy">서버 설정을 동기화한 뒤 에디터를 열어드릴게요.</p>
        <div class="app-loading-bars" aria-hidden="true">
          <div class="app-loading-bar"></div>
          <div class="app-loading-bar"></div>
          <div class="app-loading-bar"></div>
        </div>
      </div>
    </div>
  `;
}

function readConfigCache() {
  try {
    const raw = localStorage.getItem(SCOPED_CONFIG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!isValidConfigData(parsed.data)) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function writeConfigCache(cache) {
  try {
    localStorage.setItem(
      SCOPED_CONFIG_CACHE_KEY,
      JSON.stringify({ ...cache, cachedAt: Date.now() }),
    );
  } catch (e) {
    // Ignore localStorage write errors.
  }
}

async function fetchConfigMeta() {
  let lastErr = null;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch("/api/config-meta", { cache: "no-store" });
      if (!res.ok) throw new Error(`config meta api failed (${res.status})`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 160 * (i + 1)));
    }
  }
  throw lastErr || new Error("config meta api failed");
}

async function fetchConfigWithOptionalEtag(cached) {
  const headers = {};
  if (cached?.etag) headers["If-None-Match"] = cached.etag;
  let lastErr = null;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch("/api/config", { headers, cache: "no-store" });
      if (res.status === 304 && cached?.data) return cached;
      if (!res.ok) throw new Error(`config api failed (${res.status})`);
      const payload = await res.json();
      if (!payload?.data || typeof payload.data !== "object") {
        throw new Error("Invalid config payload");
      }
      return {
        version: payload.version,
        updatedAt: payload.updatedAt,
        data: payload.data,
        etag: res.headers.get("ETag") || null,
      };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
  throw lastErr || new Error("config api failed");
}

async function loadInitialData(seedCache = null) {
  const cached = seedCache || readConfigCache();
  if (hasFreshCache(cached)) {
    return cached.data;
  }
  try {
    const meta = await fetchConfigMeta();
    if (cached && Number(cached.version) === Number(meta.version)) {
      writeConfigCache(cached);
      return cached.data;
    }
    const fresh = await fetchConfigWithOptionalEtag(cached);
    writeConfigCache(fresh);
    return fresh.data;
  } catch (apiErr) {
    // If server check fails transiently, use any valid cached config as last resort.
    if (cached?.data && isValidConfigData(cached.data)) {
      writeConfigCache(cached);
      return cached.data;
    }
    const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
    if (isLocal) {
      const fallback = await fetch("/assets/data/data.json");
      if (!fallback.ok) throw apiErr;
      const fallbackData = await fallback.json();
      if (!isValidConfigData(fallbackData)) throw apiErr;
      writeConfigCache({
        version: null,
        updatedAt: null,
        data: fallbackData,
        etag: null,
      });
      return fallbackData;
    }
    throw apiErr;
  }
}

let adminRevalidateInFlight = false;

async function revalidateAdminConfig(force = false) {
  if (adminRevalidateInFlight) return;
  if (!force && document.visibilityState === "hidden") return;
  // Do not clobber local edits while user has unsaved changes.
  if (dirty || submitting || submitPending || confirmPending) return;
  adminRevalidateInFlight = true;
  try {
    const meta = await fetchConfigMeta();
    if (
      loadedConfigVersion !== null &&
      Number(meta.version) === Number(loadedConfigVersion)
    ) {
      return;
    }
    const cached = readConfigCache();
    if (
      cached &&
      Number(cached.version) === Number(meta.version) &&
      isValidConfigData(cached.data)
    ) {
      loadedConfigVersion = cached.version;
      originalData = JSON.parse(JSON.stringify(cached.data));
      data = JSON.parse(JSON.stringify(cached.data));
      undoStack.length = 0;
      serverLoadTime = Date.now();
      dirty = false;
      document.title = "태그 관리 — APPSILON";
      document.getElementById("submit-btn")?.classList.remove("dirty");
      writeConfigCache(cached);
      rerender();
      return;
    }
    const fresh = await fetchConfigWithOptionalEtag(cached);
    loadedConfigVersion = fresh.version ?? loadedConfigVersion;
    writeConfigCache(fresh);
    originalData = JSON.parse(JSON.stringify(fresh.data));
    data = JSON.parse(JSON.stringify(fresh.data));
    undoStack.length = 0;
    serverLoadTime = Date.now();
    dirty = false;
    document.title = "태그 관리 — APPSILON";
    document.getElementById("submit-btn")?.classList.remove("dirty");
    showToastMsg("최신 태그 설정을 반영했어요.");
  } catch (e) {
    // Keep current UI as-is on background revalidation failure.
  } finally {
    adminRevalidateInFlight = false;
  }
}

loadInitialData(bootstrapCache)
  .then((loaded) => {
    const d = loaded;
    if (!d || typeof d !== "object") throw new Error("유효한 데이터를 불러오지 못했어요.");
    const meta = readConfigCache();
    loadedConfigVersion = meta?.version ?? null;
    originalData = JSON.parse(JSON.stringify(d));
    const draftStr = localStorage.getItem("ad-name-generator-draft");
    if (draftStr) {
      try {
        const parsed = JSON.parse(draftStr);
        let draftData = parsed;
        if (parsed && parsed.version === 2) {
          draftData = parsed.data;
        }

        if (JSON.stringify(draftData) !== JSON.stringify(d)) {
          // Auto-restore draft silently
          data = parsed.version === 2 ? parsed.data : parsed;
          undoStack.length = 0;
          if (parsed.version === 2 && parsed.undoStack) {
            undoStack.push(...parsed.undoStack);
          }
          // Restore selected screen from last undo entry
          if (undoStack.length > 0) {
            selectedNode = undoStack[undoStack.length - 1].node ?? null;
          }
          serverLoadTime = Date.now();
          markDirty();
          setTimeout(() => {
            showToastMsg("최근 작업 내역을 복원했어요.", 4000);
          }, 500);
          return;
        }
      } catch (e) {
        // ignore parse error
      }
    }
    data = d;
    undoStack.length = 0;
    serverLoadTime = Date.now();
    rerender();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        revalidateAdminConfig(true);
      }
    });
  })
  .catch(() => {
    if (adminMainEl) {
      adminMainEl.innerHTML = `
        <div class="app-loading">
          <div class="app-loading-card">
            <h2 class="app-loading-title">초기 로딩에 실패했어요</h2>
            <p class="app-loading-copy">API 또는 data.json 경로를 확인해 주세요.</p>
          </div>
        </div>
      `;
    }
  });
