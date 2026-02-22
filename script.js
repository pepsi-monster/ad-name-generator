// ============================================================
// FRAMEWORK
// ============================================================

function h(elType, elProps = {}, ...elChildren) {
  const _elChildren = elChildren
    .flat(Infinity) // Safely unwrap nested arrays from .map()
    .filter(
      (child) =>
        child !== null && child !== undefined && typeof child !== "boolean", // Strips out 'false' from {condition && element}
    )
    .map((child) => {
      if (typeof child === "string" || typeof child === "number")
        return {
          type: "TEXT_ELEMENT",
          props: { nodeValue: child },
        };
      return child;
    });

  return { type: elType, props: { ...elProps, children: _elChildren } };
}

function mount(vNode, container) {
  if (typeof vNode.type === "function") {
    const unPackedVNode = vNode.type(vNode.props);
    vNode._dom = mount(unPackedVNode, container);
    vNode._rendered = unPackedVNode;
    return vNode._dom; // The 'return' is key!
  }

  const dom =
    vNode.type === "TEXT_ELEMENT"
      ? document.createTextNode(vNode.props.nodeValue)
      : document.createElement(vNode.type);

  vNode._dom = dom;

  if (vNode.type === "TEXT_ELEMENT") return container.appendChild(dom);

  const excluded = new Set(["children", "nodeValue"]);
  for (const [attribute, value] of Object.entries(vNode.props)) {
    if (attribute.startsWith("on")) {
      dom.addEventListener(attribute.toLowerCase().slice(2).trim(), value);
    } else if (!excluded.has(attribute)) {
      if (attribute.includes("-")) {
        dom.setAttribute(attribute, value);
      } else {
        dom[attribute] = value;
      }
    }
  }

  vNode.props.children.forEach((child) => {
    if (child === null || child == undefined) return;
    mount(child, dom);
  });

  return container.appendChild(dom);
}

const createStore = function (initialValue) {
  let value = initialValue;
  let subscribers = [];
  return {
    get: () => value,
    set: (newValue) => {
      value = newValue;
      subscribers.forEach((fn) => fn());
    },
    subscribe: (...fnArr) => {
      subscribers.push(...fnArr);
    },
  };
};

const patchProps = function (oldProps, newProps, dom) {
  const newPropsArr = Object.keys(newProps);
  const oldPropsArr = Object.keys(oldProps);

  const excluded = new Set(["children", "nodeValue"]);

  // 1. ADD or UPDATE props
  newPropsArr.forEach((attribute) => {
    if (
      (!oldPropsArr.includes(attribute) ||
        oldProps[attribute] !== newProps[attribute]) &&
      !excluded.has(attribute)
    ) {
      // Apply the same hyphen check here
      if (attribute.includes("-")) {
        dom.setAttribute(attribute, newProps[attribute]);
      } else {
        dom[attribute] = newProps[attribute];
      }
    }
  });

  // 2. REMOVE old props
  oldPropsArr.forEach((attribute) => {
    if (!newPropsArr.includes(attribute) && !excluded.has(attribute)) {
      dom.removeAttribute(attribute); // This already works great for data-/aria- tags!
    }
  });
};

const diff = function (oldVNode, newVNode, parent) {
  if (!oldVNode && !newVNode) return;
  if (!oldVNode) {
    mount(newVNode, parent);
  } else if (!newVNode) {
    parent.removeChild(oldVNode._dom);
  } else if (oldVNode.type !== newVNode.type) {
    mount(newVNode, parent);
    parent.replaceChild(newVNode._dom, oldVNode._dom);
  } else if (
    typeof oldVNode.type === "function" ||
    typeof newVNode.type === "function"
  ) {
    const unpackedOldVNode = oldVNode._rendered;
    const unpackedNewVNode = newVNode.type(newVNode.props);
    newVNode._rendered = unpackedNewVNode;
    newVNode._dom = oldVNode._dom;
    return diff(unpackedOldVNode, unpackedNewVNode, parent);
  } else if (oldVNode && newVNode) {
    if (newVNode.type === "TEXT_ELEMENT" && oldVNode.type === "TEXT_ELEMENT") {
      oldVNode._dom.nodeValue = newVNode.props.nodeValue;
      newVNode._dom = oldVNode._dom;

      return;
    }

    patchProps(oldVNode.props, newVNode.props, oldVNode._dom);
    newVNode._dom = oldVNode._dom;

    const maxLength = Math.max(
      oldVNode.props.children.length,
      newVNode.props.children.length,
    );

    for (let i = 0; i < maxLength; i++) {
      diff(
        oldVNode.props.children[i],
        newVNode.props.children[i],
        oldVNode._dom,
      );
    }
  }
};

const createRoot = function (container) {
  let oldVNode;
  return {
    render: (vNode) => {
      diff(oldVNode, vNode, container);
      oldVNode = vNode;
    },
  };
};

// ============================================================
// KOREAN SEARCH HELPERS
// ============================================================

// The 19 choseong (initial consonants) in syllable-block order,
// stored as compatibility jamo — the same code points a Korean keyboard types.
const CHOSEONG = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];

// Extract the choseong of a single Korean syllable block, or return the char as-is.
function getChoseong(char) {
  const code = char.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    return CHOSEONG[Math.floor((code - 0xac00) / 588)];
  }
  return char;
}

// Map every syllable in a string to its choseong, leaving non-syllables untouched.
// e.g. "안경" → "ㅇㄱ"
function extractChoseong(str) {
  return [...str].map(getChoseong).join("");
}

// True when every character in the query is a standalone Korean consonant jamo
// (U+3131–U+314E), meaning the user is doing a choseong-only search.
function isChoseongQuery(str) {
  return (
    str.length > 0 &&
    [...str].every((ch) => {
      const c = ch.charCodeAt(0);
      return c >= 0x3131 && c <= 0x314e;
    })
  );
}

// Smart filter: choseong-match when the query is all consonants, case-insensitive otherwise.
function matchesFilter(opt, filterText) {
  if (!filterText) return true;
  if (isChoseongQuery(filterText))
    return extractChoseong(opt).startsWith(filterText);
  return opt.toLowerCase().startsWith(filterText.toLowerCase());
}

// True when a group label contains the filter text (case-insensitive).
function labelMatchesFilter(label, filterText) {
  if (!label || !filterText) return false;
  return label.toLowerCase().includes(filterText.toLowerCase());
}

// ============================================================
// DATA — only edit this section to add/change options
// ============================================================

const DATA = {
  format: ["비디오", "이미지", "캐러셀"],

  // Plain strings = ungrouped. { label, items } = grouped. Mix is allowed.
  product: [
    "ALL",
    { label: "Refa", items: ["M1", "파인버블", "브러시", "카사업"] },
    { label: "Like Eat", items: ["쓸림쏙", "파인셔스"] },
  ],

  concept: {
    // Same format as product: plain strings or { label, items } groups.
    options: [
      { label: "인물/공감", items: ["인물", "인플루언서", "일반인", "공감형"] },
      {
        label: "정보/설득",
        items: ["기능", "정보", "리뷰", "문제해결", "비교"],
      },
      { label: "감성/퍼포먼스", items: ["감성", "대세감", "할인"] },
    ],
    // To add a concept with sub-concepts: add an entry here.
    // Value uses the same format (plain strings or { label, items } groups).
    subConcepts: {
      인플루언서: [
        {
          label: "규모",
          items: ["나노", "마이크로", "미드티어", "매크로", "준메가", "메가"],
        },
      ],
      기능: [
        {
          label: "피부 효능",
          items: [
            "보습",
            "진정",
            "미백",
            "탄력",
            "커버",
            "지속력",
            "각질",
            "광채",
          ],
        },
        {
          label: "사용감",
          items: ["흡수력", "끈적임없음", "발림성", "향", "무향", "제형"],
        },
        {
          label: "편의/포장",
          items: [
            "휴대성",
            "올인원",
            "대용량",
            "펌프형",
            "이지워시",
            "퀵",
            "하루한알",
            "2in1",
            "클렌징",
          ],
        },
        {
          label: "성분/안전",
          items: ["순함", "비건", "성분", "유기농", "고함량", "탈모"],
        },
        { label: "가격/혜택", items: ["가성비", "사은품", "한정판"] },
        {
          label: "건강기능식품",
          items: [
            "활력",
            "면역",
            "수면",
            "기억력",
            "혈행",
            "눈건강",
            "관절",
            "간건강",
            "체지방",
            "쾌변",
            "붓기",
            "소화",
            "목넘김",
            "맛",
          ],
        },
      ],
    },
  },

  version: ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10"],
};

// ============================================================
// DERIVED — do not edit below
// ============================================================

// Parses a mixed definition (plain strings + {label, items} objects) into
// { flat, groups }. groups is null when there are no grouped items.
function parseMixedOptions(def) {
  const standalone = def.filter((x) => typeof x === "string");
  const grouped = def.filter((x) => typeof x !== "string");
  const flat = [...standalone, ...grouped.flatMap((g) => g.items)];
  const groups =
    grouped.length === 0
      ? null
      : [
          ...(standalone.length ? [{ label: null, items: standalone }] : []),
          ...grouped,
        ];
  return { flat, groups };
}

const FORMAT_OPTIONS = DATA.format;
const PRODUCT = parseMixedOptions(DATA.product);
const CONCEPT = parseMixedOptions(DATA.concept.options);
const CONCEPT_GROUPS = CONCEPT.groups;
const CONCEPT_OPTIONS = CONCEPT.flat;
const SUB_CONCEPT_MAP = Object.fromEntries(
  Object.entries(DATA.concept.subConcepts).map(([name, def]) => {
    const { flat, groups } = parseMixedOptions(def);
    return [name, { options: flat, groups }];
  }),
);
const CONCEPTS_WITH_SUBCONCEPT = new Set(Object.keys(SUB_CONCEPT_MAP));
const VERSION_OPTIONS = DATA.version;

const SPEC_OPTIONS = ["1x1", "4x5", "9x16", "16x9"];

// ============================================================
// STATE
// ============================================================

const URL_FIELDS = [
  "format",
  "product",
  "concept",
  "subConcept",
  "identifier",
  "version",
];

const FIELD_DEFAULTS = { version: "v1" };

function stateFromURL() {
  const p = new URLSearchParams(location.search);
  const s = { openDropdown: null };
  URL_FIELDS.forEach((k) => {
    s[k] = p.get(k) || FIELD_DEFAULTS[k] || "";
  });
  return s;
}

function syncStateToURL(s) {
  const p = new URLSearchParams();
  URL_FIELDS.forEach((k) => {
    if (s[k]) p.set(k, s[k]);
  });
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

const state = createStore(stateFromURL());

// Per-field filter text for searchable dropdowns (not in state to avoid cursor reset)
const dropdownFilters = {};

// Per-field highlighted option index for keyboard navigation (-1 = none)
const dropdownHighlight = {};

// Declared here, assigned at the bottom after root is created
let root;
function rerender() {
  root.render(App());
}

// Kept in sync with the latest successful buildName result so the keydown
// handler can copy without touching the DOM.
let currentVariants = [];

// Undo stack — stores snapshots of URL fields only, not transient UI state.
const UNDO_MAX = 50;
let undoStack = [];

function getFieldSnapshot() {
  const s = state.get();
  return URL_FIELDS.reduce((acc, k) => ({ ...acc, [k]: s[k] }), {});
}

function pushUndoSnapshot() {
  undoStack = [getFieldSnapshot(), ...undoStack].slice(0, UNDO_MAX);
}

function handleUndo() {
  if (undoStack.length === 0) return;
  const [prev, ...rest] = undoStack;
  undoStack = rest;
  state.set({ ...state.get(), ...prev, openDropdown: null });
  showToast("되돌렸어요");
}

// Copy history — newest first, persisted to localStorage.
const COPY_HISTORY_KEY = "ad-gen-copy-history";
const COPY_HISTORY_MAX = 20;

function loadCopyHistory() {
  try {
    return JSON.parse(localStorage.getItem(COPY_HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveCopyHistory(history) {
  localStorage.setItem(COPY_HISTORY_KEY, JSON.stringify(history));
}

let copyHistory = loadCopyHistory();

function addToCopyHistory(label, name) {
  copyHistory = [{ label, name }, ...copyHistory].slice(0, COPY_HISTORY_MAX);
  saveCopyHistory(copyHistory);
  rerender();
}

function handleClearHistory() {
  copyHistory = [];
  saveCopyHistory(copyHistory);
  rerender();
}

function clearFilter(fieldName) {
  if (!fieldName) return;
  delete dropdownFilters[fieldName];
  delete dropdownHighlight[fieldName];
  // (The document.querySelector stuff used to be here - you can safely delete it!)
}

// Returns the group definition for fields that have grouped options.
// Shared between rendering and keyboard navigation so they stay in sync.
function getGroupsForField(fieldName) {
  const s = state.get();
  switch (fieldName) {
    case "product":
      return PRODUCT.groups;
    case "concept":
      return CONCEPT_GROUPS;
    case "subConcept":
      return SUB_CONCEPT_MAP[s.concept]?.groups ?? null;
    default:
      return null;
  }
}

// Returns the currently visible (post-filter) flat option list for a field.
// If the filter matches a group label, all items in that group are included.
function getVisibleOptionsForField(fieldName) {
  const s = state.get();
  const filterText = dropdownFilters[fieldName] || "";
  let options;
  switch (fieldName) {
    case "format":
      options = FORMAT_OPTIONS;
      break;
    case "product":
      options = PRODUCT.flat;
      break;
    case "concept":
      options = CONCEPT_OPTIONS;
      break;
    case "subConcept":
      options = SUB_CONCEPT_MAP[s.concept]?.options ?? [];
      break;
    default:
      return [];
  }
  if (!filterText) return options;
  const groups = getGroupsForField(fieldName);
  if (groups) {
    return groups.flatMap(({ label, items }) =>
      labelMatchesFilter(label, filterText)
        ? items
        : items.filter((opt) => matchesFilter(opt, filterText)),
    );
  }
  return options.filter((opt) => matchesFilter(opt, filterText));
}

// ============================================================
// HANDLERS
// ============================================================

// Dropdown open/close
function toggleDropdown(fieldName) {
  const current = state.get().openDropdown;
  const willOpen = current !== fieldName;
  clearFilter(current);
  state.set({
    ...state.get(),
    openDropdown: willOpen ? fieldName : null,
  });
  if (willOpen) {
    delete dropdownHighlight[fieldName];
    setTimeout(() => {
      const openMenu = document.querySelector(".dropdown-menu.open");
      if (openMenu) {
        const input = openMenu.querySelector(".dropdown-search-input");
        if (input) input.focus();
      }
    }, 0);
  }
}

// Returns the next empty field after fieldName in the fill sequence, or null.
function getNextEmptyField(fieldName, newState) {
  const sequence = [
    "format",
    "product",
    "concept",
    "subConcept",
    "identifier",
    "version",
  ];
  const hasSubConcept = CONCEPTS_WITH_SUBCONCEPT.has(newState.concept);
  const applicable = sequence.filter(
    (f) => f !== "subConcept" || hasSubConcept,
  );
  const currentIdx = applicable.indexOf(fieldName);
  for (let i = currentIdx + 1; i < applicable.length; i++) {
    if (!newState[applicable[i]]) return applicable[i];
  }
  return null;
}

// Select an option and close the dropdown.
// Uses event delegation: the handler reads data-value from the clicked option element,
// so the closure never goes stale even when option lists change.
function selectOption(fieldName, value) {
  if (state.get()[fieldName] !== value) pushUndoSnapshot();
  clearFilter(fieldName);
  const updates = { ...state.get(), [fieldName]: value, openDropdown: null };
  if (fieldName === "concept") updates.subConcept = "";

  // Auto-advance to the next empty field (skip when clearing a field).
  const next = value !== "" ? getNextEmptyField(fieldName, updates) : null;
  if (next && next !== "identifier") {
    updates.openDropdown = next;
    delete dropdownHighlight[next];
  }

  state.set(updates);

  if (next === "identifier") {
    setTimeout(() => document.querySelector(".field-input")?.focus(), 0);
  } else if (next) {
    setTimeout(() => {
      const openMenu = document.querySelector(".dropdown-menu.open");
      if (openMenu) openMenu.querySelector(".dropdown-search-input")?.focus();
    }, 0);
  }
}

// Stable toggle handlers — one per field (same reference across renders)
function toggleFormat() {
  toggleDropdown("format");
}
function toggleProduct() {
  toggleDropdown("product");
}
function toggleConcept() {
  toggleDropdown("concept");
}
function toggleSubConcept() {
  toggleDropdown("subConcept");
}
function handleVersionDecrement() {
  const idx = VERSION_OPTIONS.indexOf(state.get().version);
  if (idx <= 0) return;
  pushUndoSnapshot();
  state.set({ ...state.get(), version: VERSION_OPTIONS[idx - 1] });
}

function handleVersionIncrement() {
  const idx = VERSION_OPTIONS.indexOf(state.get().version);
  if (idx >= VERSION_OPTIONS.length - 1) return;
  pushUndoSnapshot();
  state.set({ ...state.get(), version: VERSION_OPTIONS[idx + 1] });
}

// Stable clear handlers — stop propagation so the trigger doesn't also open
function handleClearFormat(e) {
  e.stopPropagation();
  selectOption("format", "");
}
function handleClearProduct(e) {
  e.stopPropagation();
  selectOption("product", "");
}
function handleClearConcept(e) {
  e.stopPropagation();
  selectOption("concept", "");
}
function handleClearSubConcept(e) {
  e.stopPropagation();
  selectOption("subConcept", "");
}
function handleResetAll() {
  pushUndoSnapshot();
  Object.keys(dropdownFilters).forEach((k) => delete dropdownFilters[k]);
  Object.keys(dropdownHighlight).forEach((k) => delete dropdownHighlight[k]);
  state.set({
    ...state.get(),
    format: "",
    product: "",
    concept: "",
    subConcept: "",
    identifier: "",
    version: "v1",
    openDropdown: null,
  });
}

// Backspace/Delete on a focused trigger button (Tab navigation mode) clears the field
function handleTriggerKeyDown(e) {
  if (e.key !== "Backspace" && e.key !== "Delete") return;
  const fieldName = e.currentTarget.getAttribute("data-field");
  if (!fieldName) return;
  if (state.get().openDropdown === fieldName) return; // dropdown is open, don't interfere
  e.preventDefault();
  selectOption(fieldName, "");
}

// Stable menu click handlers — use event delegation via data-value JS property
function onMenuClick(fieldName, e) {
  const optionEl = e.target.closest(".dropdown-option");
  if (!optionEl) return;
  const val = optionEl.getAttribute("data-value");
  if (val == null) return;
  selectOption(fieldName, val);
}

function handleFormatMenuClick(e) {
  onMenuClick("format", e);
}
function handleProductMenuClick(e) {
  onMenuClick("product", e);
}
function handleConceptMenuClick(e) {
  onMenuClick("concept", e);
}
function handleSubConceptMenuClick(e) {
  onMenuClick("subConcept", e);
}

// Identifier history — persists across sessions via localStorage
const IDENTIFIER_HISTORY_KEY = "ad-gen-identifiers";
const IDENTIFIER_HISTORY_MAX = 10;

function loadIdentifierHistory() {
  try {
    return JSON.parse(localStorage.getItem(IDENTIFIER_HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveIdentifierToHistory(value) {
  if (!value.trim()) return;
  const prev = loadIdentifierHistory();
  const next = [value, ...prev.filter((v) => v !== value)].slice(
    0,
    IDENTIFIER_HISTORY_MAX,
  );
  localStorage.setItem(IDENTIFIER_HISTORY_KEY, JSON.stringify(next));
}

function removeIdentifierFromHistory(value) {
  const next = loadIdentifierHistory().filter((v) => v !== value);
  localStorage.setItem(IDENTIFIER_HISTORY_KEY, JSON.stringify(next));
  rerender();
}

// Identifier autocomplete state
let identifierSuggestionsOpen = false;
let identifierHighlight = -1;

function getIdentifierSuggestions() {
  const { identifier } = state.get();
  const history = loadIdentifierHistory();
  if (!history.length) return [];
  if (!identifier) return history;
  return history.filter(
    (v) =>
      v.toLowerCase().startsWith(identifier.toLowerCase()) && v !== identifier,
  );
}

function selectIdentifierSuggestion(value) {
  state.set({ ...state.get(), identifier: value });
  saveIdentifierToHistory(value);
  identifierSuggestionsOpen = false;
  identifierHighlight = -1;
}

function handleSuggestionMouseDown(e) {
  e.preventDefault();
  const removeBtn = e.target.closest(".suggestion-remove");
  if (removeBtn) {
    const item = removeBtn.closest(".suggestion-item");
    const value = item && item.getAttribute("data-value");
    if (value != null) removeIdentifierFromHistory(value);
    return;
  }
  const item = e.target.closest(".suggestion-item");
  if (!item) return;
  const value = item.getAttribute("data-value");
  if (value != null) selectIdentifierSuggestion(value);
}

// Text input
function handleIdentifierInput(e) {
  identifierHighlight = -1;
  state.set({ ...state.get(), identifier: e.target.value });
}

let identifierSnapshotOnFocus = null;

function handleIdentifierFocus() {
  identifierSnapshotOnFocus = getFieldSnapshot();
  identifierSuggestionsOpen = true;
  identifierHighlight = -1;
  rerender();
}

function handleIdentifierBlur(e) {
  if (
    identifierSnapshotOnFocus &&
    e.target.value !== identifierSnapshotOnFocus.identifier
  ) {
    undoStack = [identifierSnapshotOnFocus, ...undoStack].slice(0, UNDO_MAX);
  }
  identifierSnapshotOnFocus = null;
  saveIdentifierToHistory(e.target.value);
  identifierSuggestionsOpen = false;
  identifierHighlight = -1;
  rerender();
}

function handleIdentifierKeyDown(e) {
  if (!identifierSuggestionsOpen) return;
  const suggestions = getIdentifierSuggestions();
  if (!suggestions.length) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    identifierHighlight = Math.min(
      identifierHighlight + 1,
      suggestions.length - 1,
    );
    rerender();
    setTimeout(() => {
      const highlighted = document.querySelector(
        ".suggestions-menu .suggestion-item.highlighted",
      );
      if (highlighted) highlighted.scrollIntoView({ block: "nearest" });
    }, 0);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    identifierHighlight = Math.max(identifierHighlight - 1, -1);
    rerender();
    setTimeout(() => {
      const highlighted = document.querySelector(
        ".suggestions-menu .suggestion-item.highlighted",
      );
      if (highlighted) highlighted.scrollIntoView({ block: "nearest" });
    }, 0);
  } else if (e.key === "Enter" && identifierHighlight >= 0) {
    e.preventDefault();
    selectIdentifierSuggestion(suggestions[identifierHighlight]);
  } else if (e.key === "Escape") {
    identifierSuggestionsOpen = false;
    identifierHighlight = -1;
    rerender();
  }
}

// Searchable dropdown filter inputs
function handleProductFilterInput(e) {
  dropdownFilters.product = e.target.value;
  delete dropdownHighlight.product;
  rerender();
}
function handleConceptFilterInput(e) {
  dropdownFilters.concept = e.target.value;
  delete dropdownHighlight.concept;
  rerender();
}
function handleSubConceptFilterInput(e) {
  dropdownFilters.subConcept = e.target.value;
  delete dropdownHighlight.subConcept;
  rerender();
}

// Tracks the most recently copied name to show a checkmark on the copy button.
let recentlyCopiedId = null;
let recentlyCopiedTimer = null;

function markCopied(id) {
  if (recentlyCopiedTimer) clearTimeout(recentlyCopiedTimer);
  recentlyCopiedId = id;
  rerender();
  recentlyCopiedTimer = setTimeout(() => {
    recentlyCopiedId = null;
    recentlyCopiedTimer = null;
    rerender();
  }, 1500);
}

// Copy handlers — read name from element property so they never go stale

function handleVariantCopy(e) {
  const name = e.currentTarget.getAttribute("data-copy-text");
  const label = e.currentTarget.getAttribute("data-copy-label");
  const index = e.currentTarget.getAttribute("data-copy-index");
  if (name) {
    navigator.clipboard.writeText(name);
    addToCopyHistory(label || "", name);
    showToast("복사되었어요", name);
    markCopied("output-" + index);
  }
}

function handleCopyLink() {
  navigator.clipboard.writeText(location.href);
  showToast("공유용 링크가 복사되었어요");
  markCopied("link");
}

function handleCopyAll() {
  if (!currentVariants.length) return;
  navigator.clipboard.writeText(currentVariants.map((v) => v.name).join("\n"));
  showToast("모두 복사되었어요");
}

let shortcutsOpen = false;
let shortcutsHovered = false;

function handleToggleShortcuts(e) {
  e.stopPropagation();
  shortcutsOpen = true;
  rerender();
}
function handleShortcutsMouseEnter() {
  shortcutsHovered = true;
  rerender();
}
function handleShortcutsMouseLeave() {
  shortcutsHovered = false;
  rerender();
}

function handleHistoryItemCopy(e) {
  const name = e.currentTarget.getAttribute("data-copy-text");
  const index = e.currentTarget.getAttribute("data-copy-index");
  if (name) {
    navigator.clipboard.writeText(name);
    showToast("복사되었어요", name);
    markCopied("history-" + index);
  }
}

function showToast(message, name) {
  const toast = document.createElement("div");
  toast.className = "toast";
  if (name) {
    const label = document.createElement("div");
    label.className = "toast-label";
    label.textContent = message;
    const nameEl = document.createElement("div");
    nameEl.className = "toast-name";
    nameEl.textContent = name;
    toast.appendChild(label);
    toast.appendChild(nameEl);
  } else {
    toast.textContent = message;
  }
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("toast--visible");
  });

  setTimeout(() => {
    toast.classList.remove("toast--visible");
    toast.addEventListener("transitionend", () => toast.remove(), {
      once: true,
    });
  }, 2000);
}

// Close shortcuts panel when clicking outside
document.addEventListener("click", (e) => {
  if (shortcutsOpen && !e.target.closest(".footer-shortcuts-wrapper")) {
    shortcutsOpen = false;
    rerender();
  }
});

// Close dropdown when clicking outside any dropdown container
document.addEventListener("click", (e) => {
  if (
    !e.target.closest(".dropdown-container") &&
    state.get().openDropdown !== null
  ) {
    clearFilter(state.get().openDropdown);
    state.set({ ...state.get(), openDropdown: null });
  }
});

// Keyboard navigation for open dropdowns
document.addEventListener("keydown", (e) => {
  const { openDropdown } = state.get();
  if (!openDropdown) return;

  if (e.key === "Escape") {
    clearFilter(openDropdown);
    state.set({ ...state.get(), openDropdown: null });
    return;
  }

  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const options = getVisibleOptionsForField(openDropdown);
    if (options.length === 0) return;
    const current = dropdownHighlight[openDropdown] ?? -1;
    dropdownHighlight[openDropdown] =
      e.key === "ArrowDown"
        ? Math.min(current + 1, options.length - 1)
        : Math.max(current - 1, 0);
    rerender();
    setTimeout(() => {
      const highlighted = document.querySelector(
        ".dropdown-menu.open .dropdown-option.highlighted",
      );
      if (highlighted) highlighted.scrollIntoView({ block: "nearest" });
    }, 0);
    return;
  }

  if (e.key === "Enter") {
    const options = getVisibleOptionsForField(openDropdown);
    const current = dropdownHighlight[openDropdown] ?? -1;
    if (current >= 0 && current < options.length) {
      e.preventDefault();
      const fieldName = openDropdown;
      delete dropdownHighlight[fieldName];
      selectOption(fieldName, options[current]);
    }
  }
});

// Undo: Ctrl+Z / Cmd+Z — only when no input is focused (let browser handle text undo).
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "z") {
    if (document.activeElement.tagName === "INPUT") return;
    e.preventDefault();
    handleUndo();
  }
});

// Number key shortcuts (1–5) to copy output variants.
// Only fires when no input is focused and no dropdown is open.
document.addEventListener("keydown", (e) => {
  if (state.get().openDropdown) return;
  if (document.activeElement.tagName === "INPUT") return;

  const idx = parseInt(e.key, 10);
  if (idx >= 1 && idx <= 5 && currentVariants[idx - 1]) {
    const variant = currentVariants[idx - 1];
    navigator.clipboard.writeText(variant.name);
    addToCopyHistory(variant.label, variant.name);
    showToast("복사되었어요", variant.name);
    markCopied("output-" + (idx - 1));
  }
});

// ============================================================
// LOGIC
// ============================================================

function buildName(fields) {
  const { format, product, concept, subConcept, identifier, version } = fields;
  const hasSubCategory = CONCEPTS_WITH_SUBCONCEPT.has(concept);

  // State 1: Nothing filled
  const allEmpty =
    !format && !product && !concept && !subConcept && !identifier;
  if (allEmpty) {
    return {
      status: "waiting",
      message: "소재명이 여기에 나타나요. 항목을 채워보세요!",
    };
  }

  // State 2: Sub-concept conflict
  if (!hasSubCategory && subConcept) {
    return {
      status: "error",
      message: "⛔ 소분류 적용이 불가한 소재 콘셉이에요. 소분류를 비워주세요.",
    };
  }

  // State 3: Missing required fields
  const requiredFields = hasSubCategory
    ? [
        { value: format, label: "포맷" },
        { value: product, label: "제품" },
        { value: concept, label: "소재 컨셉" },
        { value: subConcept, label: "세부 콘셉" },
        { value: identifier, label: "소재 고유 식별자" },
      ]
    : [
        { value: format, label: "포맷" },
        { value: product, label: "제품" },
        { value: concept, label: "소재 컨셉" },
        { value: identifier, label: "소재 고유 식별자" },
      ];

  const missing = requiredFields.filter((f) => !f.value).map((f) => f.label);
  if (missing.length > 0) {
    return { status: "missing", missing };
  }

  // State 4: Success — generate one variant per spec plus a no-spec variant
  const conceptPart = hasSubCategory ? `${concept}[${subConcept}]` : concept;
  const base = [format, product, conceptPart, identifier, version].join("_");
  const variants = [
    { label: "공통", name: base },
    ...SPEC_OPTIONS.map((spec) => ({
      label: spec.replace("x", "×"),
      name: `${base}_${spec}`,
    })),
  ];
  return { status: "success", variants };
}

// ============================================================
// COMPONENTS
// ============================================================

// Shared option renderer used by CustomDropdown (flat and grouped modes)
function renderOption(
  fieldName,
  opt,
  selectedValue,
  subOptions,
  isHighlighted,
) {
  const classes = ["dropdown-option"];
  if (selectedValue === opt) classes.push("selected");
  if (isHighlighted) classes.push("highlighted");
  return h(
    "div",
    {
      id: `dropdown-option-${fieldName}-${opt.replace(/\s+/g, "-")}`,
      className: classes.join(" "),
      "data-value": opt,
      role: "option",
      "aria-selected": selectedValue === opt,
    },
    h("span", { className: "option-label" }, opt),
    subOptions && subOptions.has(opt)
      ? h(
          "span",
          { className: "material-symbols-rounded option-sub-icon" },
          "tune",
        )
      : null,
    h("span", { className: "material-symbols-rounded check-icon" }, "check"),
  );
}

// Custom dropdown — always renders the menu in the DOM, toggles visibility via CSS class.
// Options use event delegation (onMenuClick on the menu div) so we never get stale
// per-option click handlers when the option list changes (e.g. 인플루언서 → 기능).
const CustomDropdown = (props) => {
  const {
    fieldName,
    value,
    options,
    onToggle,
    onMenuClick,
    searchable,
    onFilterInput,
    subOptions,
    groups,
    onClear,
    ariaLabelId,
    activeDescendantId,
  } = props;
  const isOpen = state.get().openDropdown === fieldName;
  const filterText = dropdownFilters[fieldName] || "";
  const filteredOptions =
    searchable && filterText
      ? options.filter((opt) => matchesFilter(opt, filterText))
      : options;
  const highlightIdx = dropdownHighlight[fieldName] ?? -1;

  return h(
    "div",
    { className: "dropdown-container" },
    h(
      "button",
      {
        id: `dropdown-trigger-${fieldName}`,
        className: isOpen ? "dropdown-trigger open" : "dropdown-trigger",
        onClick: onToggle,
        onKeyDown: handleTriggerKeyDown,
        "data-field": fieldName,
        type: "button",
        role: "combobox",
        "aria-haspopup": "listbox",
        "aria-expanded": isOpen,
        "aria-controls": `dropdown-menu-${fieldName}`,
        "aria-labelledby": ariaLabelId,
        "aria-activedescendant": activeDescendantId,
      },
      h(
        "span",
        { className: value ? "dropdown-value" : "dropdown-value placeholder" },
        value || "선택",
      ),
      subOptions && value && subOptions.has(value)
        ? h(
            "span",
            { className: "material-symbols-rounded trigger-sub-icon" },
            "tune",
          )
        : null,
      h(
        "span",
        {
          className: value
            ? "dropdown-clear"
            : "dropdown-clear dropdown-clear--hidden",
          onClick: onClear,
        },
        h("span", { className: "material-symbols-rounded" }, "close"),
      ),
      h(
        "span",
        { className: "material-symbols-rounded dropdown-chevron" },
        "expand_more",
      ),
    ),
    h(
      "div",
      {
        id: `dropdown-menu-${fieldName}`,
        className: isOpen ? "dropdown-menu open" : "dropdown-menu",
        onClick: onMenuClick,
        role: "listbox",
      },
      searchable
        ? h(
            "div",
            { className: "dropdown-search" },
            h(
              "span",
              { className: "material-symbols-rounded dropdown-search-icon" },
              "search",
            ),
            h("input", {
              className: "dropdown-search-input",
              type: "text",
              placeholder: "검색",
              value: filterText,
              onInput: onFilterInput,
            }),
          )
        : null,
      ...(groups
        ? (() => {
            let optIdx = 0;
            let anyVisible = false;
            const rendered = groups.flatMap(({ label, items }) => {
              const groupMatch = labelMatchesFilter(label, filterText);
              const visibleItems =
                filterText && !groupMatch
                  ? items.filter((opt) => matchesFilter(opt, filterText))
                  : items;
              if (visibleItems.length === 0) return [];
              anyVisible = true;
              return [
                ...(label
                  ? [h("div", { className: "dropdown-group-label" }, label)]
                  : []),
                ...visibleItems.map((opt) => {
                  const isHighlighted = optIdx === highlightIdx;
                  optIdx++;
                  return renderOption(
                    fieldName,
                    opt,
                    value,
                    subOptions,
                    isHighlighted,
                  );
                }),
              ];
            });
            return [
              ...rendered,
              searchable && filterText && !anyVisible
                ? h(
                    "div",
                    { className: "dropdown-no-results" },
                    "검색 결과가 없어요",
                  )
                : null,
            ];
          })()
        : [
            ...filteredOptions.map((opt, i) =>
              renderOption(
                fieldName,
                opt,
                value,
                subOptions,
                i === highlightIdx,
              ),
            ),
            searchable && filterText && filteredOptions.length === 0
              ? h(
                  "div",
                  { className: "dropdown-no-results" },
                  "검색 결과가 없어요",
                )
              : null,
          ]),
    ),
  );
};

// Labeled row wrapping a dropdown
const DropdownField = (props) => {
  const {
    label,
    icon,
    fieldName,
    value,
    options,
    onToggle,
    onMenuClick,
    tooltip,
    searchable,
    onFilterInput,
    subOptions,
    groups,
    onClear,
  } = props;
  return h(
    "div",
    { className: "field-row" },
    h(
      "label",
      { className: "field-label", id: `dropdown-label-${fieldName}` },
      h("span", { className: "material-symbols-rounded field-icon" }, icon),
      label,
      h("span", { className: "field-tooltip" }, tooltip),
    ),
    h(CustomDropdown, {
      fieldName,
      value,
      options,
      onToggle,
      onMenuClick,
      searchable,
      onFilterInput,
      subOptions,
      groups,
      onClear,
      ariaLabelId: `dropdown-label-${fieldName}`,
    }),
  );
};

// Stepper control for the version field (always v1+, never empty)
const VersionStepper = ({ value, tooltip }) => {
  const idx = VERSION_OPTIONS.indexOf(value);
  const atMin = idx <= 0;
  const atMax = idx >= VERSION_OPTIONS.length - 1;
  return h(
    "div",
    { className: "field-row" },
    h(
      "label",
      { className: "field-label" },
      h(
        "span",
        { className: "material-symbols-rounded field-icon" },
        "history",
      ),
      "버전",
      h("span", { className: "field-tooltip" }, tooltip),
    ),
    h(
      "div",
      { className: "version-stepper" },
      h("span", { className: "version-value" }, value),
      h(
        "div",
        { className: "version-stepper-actions" },
        h(
          "button",
          {
            className: "version-btn",
            onClick: handleVersionDecrement,
            disabled: atMin,
            type: "button",
            tabIndex: -1,
            "aria-label": "버전 낮추기",
          },
          h("span", { className: "material-symbols-rounded" }, "remove"),
        ),
        h("span", { className: "version-sep" }),
        h(
          "button",
          {
            className: "version-btn",
            onClick: handleVersionIncrement,
            disabled: atMax,
            type: "button",
            tabIndex: -1,
            "aria-label": "버전 높이기",
          },
          h("span", { className: "material-symbols-rounded" }, "add"),
        ),
      ),
    ),
  );
};

// Labeled row wrapping the free text input
const InputField = (props) => {
  const {
    label,
    icon,
    value,
    onInput,
    onBlur,
    onFocus,
    onKeyDown,
    placeholder,
    tooltip,
    suggestions,
    highlightIdx,
  } = props;
  return h(
    "div",
    { className: "field-row" },
    h(
      "label",
      { className: "field-label" },
      h("span", { className: "material-symbols-rounded field-icon" }, icon),
      label,
      h("span", { className: "field-tooltip" }, tooltip),
    ),
    h(
      "div",
      { className: "input-wrapper" },
      h("input", {
        className: "field-input",
        type: "text",
        value,
        onInput,
        onBlur,
        onFocus,
        onKeyDown,
        placeholder,
      }),
      suggestions && suggestions.length > 0
        ? h(
            "div",
            {
              className: "suggestions-menu",
              onMouseDown: handleSuggestionMouseDown,
            },
            ...suggestions.map((s, i) =>
              h(
                "div",
                {
                  className:
                    i === highlightIdx
                      ? "suggestion-item highlighted"
                      : "suggestion-item",
                  "data-value": s,
                },
                h("span", { className: "suggestion-text" }, s),
                h(
                  "button",
                  {
                    className: "suggestion-remove",
                    type: "button",
                    tabIndex: -1,
                    title: "기록에서 삭제",
                  },
                  h("span", { className: "material-symbols-rounded" }, "close"),
                ),
              ),
            ),
          )
        : null,
    ),
  );
};

const OutputDisplay = (props) => {
  const { result } = props;

  if (result.status === "waiting") {
    return h("div", { className: "output output--waiting" }, result.message);
  }
  if (result.status === "missing") {
    return h(
      "div",
      { className: "output output--missing" },
      h("div", { className: "output-missing-label" }, "다음 항목을 채워주세요"),
      h(
        "div",
        { className: "output-missing-chips" },
        ...result.missing.map((label) =>
          h("span", { className: "output-missing-chip" }, label),
        ),
      ),
    );
  }
  if (result.status === "error") {
    return h("div", { className: "output output--error" }, result.message);
  }

  return h(
    "div",
    { className: "output output--success" },
    h(
      "div",
      { className: "output-variants" },
      ...result.variants.map(({ label, name }, i) =>
        h(
          "div",
          { className: "output-variant" },
          h("span", { className: "output-variant-label" }, label),
          h("div", { className: "output-name" }, name),
          h("kbd", { className: "shortcut-hint" }, String(i + 1)),
          h(
            "button",
            {
              className: "copy-btn",
              onClick: handleVariantCopy,
              "data-copy-text": name,
              "data-copy-label": label,
              "data-copy-index": i,
              title: "복사",
            },
            h(
              "span",
              { className: "material-symbols-rounded" },
              recentlyCopiedId === "output-" + i ? "check" : "content_copy",
            ),
          ),
        ),
      ),
    ),
    h(
      "div",
      { className: "output-copy-all" },
      h(
        "button",
        { className: "copy-all-btn", onClick: handleCopyAll, type: "button" },
        h("span", { className: "material-symbols-rounded" }, "content_copy"),
        "모두 복사하기",
      ),
    ),
  );
};

const ShortcutsPanel = () => {
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
  const modKey = isMac ? "⌘" : "Ctrl";
  const rows = [
    { keys: ["1", "–", "5"], desc: "소재명 복사" },
    { keys: [modKey, "Z"], desc: "되돌리기" },
    { keys: ["↑", "↓"], desc: "드롭다운 탐색" },
    { keys: ["Enter"], desc: "옵션 선택" },
    { keys: ["Esc"], desc: "드롭다운 닫기" },
    { keys: ["⌫"], desc: "필드 지우기" },
  ];
  return h(
    "div",
    { className: "shortcuts-panel" },
    h("div", { className: "shortcuts-panel-title" }, "단축키"),
    ...rows.map(({ keys, desc }) =>
      h(
        "div",
        { className: "shortcut-row" },
        h(
          "div",
          { className: "shortcut-keys" },
          ...keys.map((k) => h("kbd", { className: "shortcut-key" }, k)),
        ),
        h("span", { className: "shortcut-desc" }, desc),
      ),
    ),
  );
};

const ShareSection = () =>
  h(
    "div",
    { className: "share-section" },
    h("p", { className: "share-heading" }, "광고 소재 이름이 생성되었어요!"),
    h(
      "p",
      { className: "share-subtext" },
      "링크를 공유하면 공유 받은 사람도 같은 소재명을 바로 확인할 수 있어요",
    ),
    h(
      "div",
      { className: "share-input-row" },
      h("input", {
        className: "share-url-input",
        type: "text",
        value: decodeURIComponent(location.href),
        readOnly: true,
      }),
      h(
        "button",
        {
          className: "share-copy-btn",
          onClick: handleCopyLink,
          type: "button",
          title: "링크 복사",
        },
        h(
          "span",
          { className: "material-symbols-rounded" },
          recentlyCopiedId === "link" ? "check" : "content_copy",
        ),
      ),
    ),
  );

const CopyHistoryCard = (props) => {
  const { history } = props;
  return h(
    "div",
    { className: "card history-card" },
    h(
      "div",
      { className: "history-header" },
      h(
        "span",
        { className: "material-symbols-rounded history-icon" },
        "history",
      ),
      "최근 복사 내역",
      h(
        "button",
        {
          className: "history-clear-btn",
          onClick: handleClearHistory,
          tabIndex: -1,
          type: "button",
          title: "기록 지우기",
        },
        h("span", { className: "material-symbols-rounded" }, "delete_sweep"),
        "모두 지우기",
      ),
    ),
    h(
      "div",
      { className: "history-list" },
      ...history.map(({ label, name }, i) =>
        h(
          "div",
          { className: "history-item" },
          h("span", { className: "history-item-label" }, label),
          h("div", { className: "history-item-name" }, name),
          h(
            "button",
            {
              className: "copy-btn",
              onClick: handleHistoryItemCopy,
              "data-copy-text": name,
              "data-copy-index": i,
              title: "복사",
            },
            h(
              "span",
              { className: "material-symbols-rounded" },
              recentlyCopiedId === "history-" + i ? "check" : "content_copy",
            ),
          ),
        ),
      ),
    ),
  );
};

function App() {
  const s = state.get();
  const hasSubConcept = CONCEPTS_WITH_SUBCONCEPT.has(s.concept);
  const subConceptEntry = SUB_CONCEPT_MAP[s.concept];
  const subConceptOptions = subConceptEntry?.options ?? [];
  const subConceptGroups = subConceptEntry?.groups ?? null;
  const result = buildName(s);
  currentVariants = result.status === "success" ? result.variants : [];
  const anyFilled = !!(s.format || s.product || s.concept || s.identifier);

  // Calculate activeDescendantId for the currently open dropdown
  let activeDescendantId = undefined;
  if (s.openDropdown) {
    const options = getVisibleOptionsForField(s.openDropdown);
    const highlightedOptionIndex = dropdownHighlight[s.openDropdown];
    if (
      highlightedOptionIndex !== undefined &&
      options[highlightedOptionIndex]
    ) {
      const highlightedOption = options[highlightedOptionIndex];
      activeDescendantId = `dropdown-option-${s.openDropdown}-${highlightedOption.replace(/\s+/g, "-")}`;
    }
  }

  return h(
    "div",
    { id: "app" },
    h(
      "main",
      {},
      h(
        "div",
        { className: "card" },
        h(
          "header",
          { className: "app-header" },
          h("h1", { className: "app-title" }, "APPSILON 소재명 생성기"),
          h(
            "p",
            { className: "app-subtitle" },
            "몇 가지 선택만으로 광고 소재명을 빠르게 만들어드려요",
          ),
        ),
        h("div", { className: "divider" }),

        h(
          "div",
          { className: "field-list" },
          h(DropdownField, {
            label: "포맷",
            icon: "perm_media",
            fieldName: "format",
            value: s.format,
            options: FORMAT_OPTIONS,
            onToggle: toggleFormat,
            onMenuClick: handleFormatMenuClick,
            onClear: handleClearFormat,
            tooltip: "소재 파일의 형식을 구분하는 항목",
            activeDescendantId:
              s.openDropdown === "format" ? activeDescendantId : undefined,
          }),
          h(DropdownField, {
            label: "제품",
            icon: "inventory_2",
            fieldName: "product",
            value: s.product,
            options: PRODUCT.flat,
            groups: PRODUCT.groups,
            onToggle: toggleProduct,
            onMenuClick: handleProductMenuClick,
            onClear: handleClearProduct,
            tooltip: "이 소재가 홍보하는 제품을 선택하는 항목",
            searchable: true,
            onFilterInput: handleProductFilterInput,
          }),
          h(DropdownField, {
            label: "소재 컨셉",
            icon: "lightbulb",
            fieldName: "concept",
            value: s.concept,
            options: CONCEPT_OPTIONS,
            onToggle: toggleConcept,
            onMenuClick: handleConceptMenuClick,
            onClear: handleClearConcept,
            tooltip: "소재의 핵심 콘셉트를 선택하는 항목",
            searchable: true,
            onFilterInput: handleConceptFilterInput,
            subOptions: CONCEPTS_WITH_SUBCONCEPT,
            groups: CONCEPT_GROUPS,
          }),
          h(
            "div",
            {
              className: hasSubConcept
                ? "sub-concept-wrapper"
                : "sub-concept-wrapper hidden",
            },
            h(DropdownField, {
              label: "세부 콘셉",
              icon: "tune",
              fieldName: "subConcept",
              value: s.subConcept,
              options: subConceptOptions,
              onToggle: toggleSubConcept,
              onMenuClick: handleSubConceptMenuClick,
              onClear: handleClearSubConcept,
              tooltip: "특정 콘셉트를 더 정밀하게 분류하기 위해 사용하는 항목",
              searchable: true,
              onFilterInput: handleSubConceptFilterInput,
              groups: subConceptGroups,
            }),
          ),
          h(InputField, {
            label: "소재 고유 식별자",
            icon: "badge",
            value: s.identifier,
            onInput: handleIdentifierInput,
            onBlur: handleIdentifierBlur,
            onFocus: handleIdentifierFocus,
            onKeyDown: handleIdentifierKeyDown,
            placeholder: "예: 바이럴, 여름세일, 블프",
            tooltip: "내부 소통을 위해 붙이는 소재의 짧은 별명",
            suggestions: identifierSuggestionsOpen
              ? getIdentifierSuggestions()
              : [],
            highlightIdx: identifierHighlight,
          }),
          h(VersionStepper, {
            value: s.version,
            tooltip: "해당 소재의 버전을 입력하는 항목",
          }),
        ),
        anyFilled
          ? h(
              "div",
              { className: "reset-row" },
              h(
                "button",
                {
                  className: "reset-btn",
                  onClick: handleResetAll,
                  type: "button",
                  tabIndex: -1,
                },
                h(
                  "span",
                  { className: "material-symbols-rounded" },
                  "restart_alt",
                ),
                "초기화",
              ),
            )
          : null,
        h("div", { className: "divider" }),
        result.status === "success" ? h(ShareSection, {}) : null,
        h(OutputDisplay, { result }),
      ),
      copyHistory.length > 0
        ? h(CopyHistoryCard, { history: copyHistory })
        : null,
    ),
    h(
      "footer",
      { className: "app-footer" },
      h(
        "div",
        {
          className: "footer-shortcuts-wrapper",
          onMouseEnter: handleShortcutsMouseEnter,
          onMouseLeave: handleShortcutsMouseLeave,
        },
        shortcutsOpen || shortcutsHovered ? h(ShortcutsPanel, {}) : null,
        h(
          "button",
          {
            className: `footer-link footer-shortcuts-btn${shortcutsOpen ? " pinned" : ""}`,
            onClick: handleToggleShortcuts,
            type: "button",
          },
          h(
            "span",
            { className: "material-symbols-rounded footer-icon" },
            "keyboard",
          ),
          "단축키",
        ),
      ),
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
    ),
  );
}

// ============================================================
// INIT
// ============================================================

root = createRoot(document.body);
state.subscribe(() => {
  syncStateToURL(state.get());
  root.render(App());
});
root.render(App());
