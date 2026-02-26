// Framework lives in framework.js — loaded before this script.

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
// DATE HELPERS
// ============================================================

function todayYYMMDD() {
  const d = new Date();
  return (
    String(d.getFullYear()).slice(2) +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0")
  );
}

function toYYMMDD(date) {
  return (
    String(date.getFullYear()).slice(2) +
    String(date.getMonth() + 1).padStart(2, "0") +
    String(date.getDate()).padStart(2, "0")
  );
}

function parseYYMMDD(str) {
  if (!str || str.length !== 6) return null;
  const year = 2000 + parseInt(str.slice(0, 2), 10);
  const month = parseInt(str.slice(2, 4), 10) - 1;
  const day = parseInt(str.slice(4, 6), 10);
  const d = new Date(year, month, day);
  return isNaN(d.getTime()) ? null : d;
}

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

let FORMAT_OPTIONS,
  PRODUCT,
  CONCEPT,
  CONCEPT_GROUPS,
  CONCEPT_OPTIONS,
  SUB_CONCEPT_MAP,
  CONCEPTS_WITH_SUBCONCEPT,
  VERSION_OPTIONS;

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
  "date",
];

const FIELD_DEFAULTS = { version: "v1", date: todayYYMMDD() };

function stateFromURL() {
  let search = location.search;
  // If URL has no params, fall back to last saved state from localStorage
  if (!search) {
    const saved = localStorage.getItem(INDEX_STATE_KEY);
    if (saved) search = "?" + saved;
  }
  const p = new URLSearchParams(search);
  const s = { openDropdown: null };
  URL_FIELDS.forEach((k) => {
    s[k] = p.get(k) || FIELD_DEFAULTS[k] || "";
  });
  if (s.date && !parseYYMMDD(s.date)) s.date = todayYYMMDD();
  return s;
}

const INDEX_STATE_KEY = "ad-gen-index-state";

function syncStateToURL(s) {
  const p = new URLSearchParams();
  URL_FIELDS.forEach((k) => {
    if (s[k]) p.set(k, s[k]);
  });
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  // Persist to localStorage so navigating away and back restores this state
  localStorage.setItem(INDEX_STATE_KEY, qs || "");
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

// Date picker UI state (not in store — doesn't need URL sync)
let datePickerOpen = false;
let datePickerViewYear = new Date().getFullYear();
let datePickerViewMonth = new Date().getMonth();

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
let confirmClearHistoryOpen = false;

function addToCopyHistory(label, name) {
  copyHistory = [{ label, name }, ...copyHistory].slice(0, COPY_HISTORY_MAX);
  saveCopyHistory(copyHistory);
  rerender();
}

function handleClearHistoryClick() {
  confirmClearHistoryOpen = true;
  rerender();
}

function handleConfirmClearHistory() {
  confirmClearHistoryOpen = false;
  copyHistory = [];
  saveCopyHistory(copyHistory);
  rerender();
}

function handleCancelClearHistory() {
  confirmClearHistoryOpen = false;
  rerender();
}

function handleClearHistoryModalBackdrop(e) {
  if (e.target.closest(".modal-dialog")) return;
  confirmClearHistoryOpen = false;
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
function handleClearDate(e) {
  e.stopPropagation();
  datePickerOpen = false;
  state.set({ ...state.get(), date: "" });
}
function handleResetAll() {
  pushUndoSnapshot();
  datePickerOpen = false;
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
    date: todayYYMMDD(),
    openDropdown: null,
  });
}

function handleDatePickerToggle() {
  datePickerOpen = !datePickerOpen;
  if (datePickerOpen) {
    const d = parseYYMMDD(state.get().date) || new Date();
    datePickerViewYear = d.getFullYear();
    datePickerViewMonth = d.getMonth();
  }
  rerender();
}

function handleDatePickerPrevMonth() {
  if (datePickerViewMonth === 0) {
    datePickerViewMonth = 11;
    datePickerViewYear--;
  } else {
    datePickerViewMonth--;
  }
  rerender();
}

function handleDatePickerNextMonth() {
  if (datePickerViewMonth === 11) {
    datePickerViewMonth = 0;
    datePickerViewYear++;
  } else {
    datePickerViewMonth++;
  }
  rerender();
}

function handleDatePickerGridClick(e) {
  const cell = e.target.closest(".dp-day");
  if (!cell) return;
  const dateStr = cell.getAttribute("data-date");
  if (!dateStr) return;
  pushUndoSnapshot();
  datePickerOpen = false;
  state.set({ ...state.get(), date: dateStr });
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
    showToast("복사했어요", name);
    markCopied("output-" + index);
  }
}

function handleCopyLink() {
  navigator.clipboard.writeText(location.href);
  showToast("공유 링크를 복사했어요");
  markCopied("link");
}

function handleCopyAll() {
  if (!currentVariants.length) return;
  navigator.clipboard.writeText(currentVariants.map((v) => v.name).join("\n"));
  showToast("전체를 복사했어요");
}

function focusMissingField(fieldKey) {
  const s = state.get();
  if (!fieldKey) return;

  if (fieldKey === "identifier") {
    if (s.openDropdown) clearFilter(s.openDropdown);
    state.set({ ...s, openDropdown: null });
    setTimeout(() => {
      const input = document.querySelector(".field-input");
      if (input) input.focus();
    }, 0);
    return;
  }

  if (fieldKey === "subConcept" && !CONCEPTS_WITH_SUBCONCEPT.has(s.concept)) {
    return;
  }

  if (s.openDropdown && s.openDropdown !== fieldKey) clearFilter(s.openDropdown);
  delete dropdownHighlight[fieldKey];
  state.set({ ...state.get(), openDropdown: fieldKey });

  // Target the exact field's trigger/menu to avoid focusing the wrong dropdown.
  const focusTarget = () => {
    const trigger = document.getElementById(`dropdown-trigger-${fieldKey}`);
    const menu = document.getElementById(`dropdown-menu-${fieldKey}`);
    if (!trigger || !menu) return false;
    trigger.focus();
    const input = menu.querySelector(".dropdown-search-input");
    if (input) input.focus();
    trigger.scrollIntoView({ block: "nearest" });
    return true;
  };

  setTimeout(() => {
    if (focusTarget()) return;
    setTimeout(focusTarget, 16);
  }, 0);
}

function handleMissingFieldClick(e) {
  e.preventDefault();
  e.stopPropagation();
  const fieldKey = e.currentTarget.getAttribute("data-field-key");
  focusMissingField(fieldKey);
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
    showToast("복사했어요", name);
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

// Close datepicker when clicking outside its container
document.addEventListener("click", (e) => {
  if (datePickerOpen && !e.target.closest(".datepicker-container")) {
    datePickerOpen = false;
    rerender();
  }
});

// Keyboard navigation for open dropdowns
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && datePickerOpen) {
    datePickerOpen = false;
    rerender();
    return;
  }

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
    showToast("복사했어요", variant.name);
    markCopied("output-" + (idx - 1));
  }
});

// ============================================================
// LOGIC
// ============================================================

function buildName(fields) {
  const { format, product, concept, subConcept, identifier, version, date } =
    fields;
  const hasSubCategory = CONCEPTS_WITH_SUBCONCEPT.has(concept);

  // State 1: Nothing filled
  const allEmpty =
    !format && !product && !concept && !subConcept && !identifier;
  if (allEmpty) {
    return {
      status: "waiting",
      message: "소재명이 여기에 표시돼요. 태그를 선택해 주세요!",
    };
  }

  // State 2: Sub-concept conflict
  if (!hasSubCategory && subConcept) {
    return {
      status: "error",
      message: "⛔ 이 소재 컨셉에는 세부 컨셉을 적용할 수 없어요. 세부 컨셉을 비워 주세요.",
    };
  }

  // State 3: Blocking validations take priority over missing-field guidance
  const warnings = getBlockingWarnings(fields);
  if (warnings.length > 0) {
    return { status: "invalid", warnings };
  }

  // State 4: Missing required fields
  const requiredFields = hasSubCategory
    ? [
      { key: "format", value: format, label: "포맷" },
      { key: "product", value: product, label: "제품" },
      { key: "concept", value: concept, label: "소재 컨셉" },
      { key: "subConcept", value: subConcept, label: "세부 컨셉" },
      { key: "identifier", value: identifier, label: "소재 별명" },
    ]
    : [
      { key: "format", value: format, label: "포맷" },
      { key: "product", value: product, label: "제품" },
      { key: "concept", value: concept, label: "소재 컨셉" },
      { key: "identifier", value: identifier, label: "소재 별명" },
    ];

  const missing = requiredFields
    .filter((f) => !f.value)
    .map(({ key, label }) => ({ key, label }));
  if (missing.length > 0) {
    return { status: "missing", missing };
  }

  // State 5: Success — generate one variant per spec plus a no-spec variant
  const conceptPart = hasSubCategory ? `${concept}[${subConcept}]` : concept;
  const nameParts = [format, product, conceptPart, identifier, version];
  if (date) nameParts.push(date);
  const base = nameParts.join("_");
  const variants = [
    { label: "공통", name: base },
    ...SPEC_OPTIONS.map((spec) => ({
      label: spec.replace("x", "×"),
      name: `${base}_${spec}`,
    })),
  ];
  return { status: "success", variants };
}

function getBlockingWarnings(fields) {
  const { format, product, concept, subConcept, identifier, version, date } =
    fields;
  if (format && !FORMAT_OPTIONS.includes(format)) {
    return ["포맷이 현재 목록에 없어요. 다시 선택해 주세요."];
  }
  if (product && !PRODUCT.flat.includes(product)) {
    return ["제품이 현재 목록에 없어요. 다시 선택해 주세요."];
  }
  if (concept && !CONCEPT_OPTIONS.includes(concept)) {
    return ["소재 컨셉이 현재 목록에 없어요. 다시 선택해 주세요."];
  }
  const hasSubCategory = CONCEPTS_WITH_SUBCONCEPT.has(concept);
  if (hasSubCategory && subConcept) {
    const subOptions = SUB_CONCEPT_MAP[concept]?.options || [];
    if (!subOptions.includes(subConcept)) {
      return ["세부 컨셉이 현재 목록에 없어요. 다시 선택해 주세요."];
    }
  }
  if (version && !VERSION_OPTIONS.includes(version)) {
    return ["버전 값이 올바르지 않아요. 다시 선택해 주세요."];
  }
  const trimmedIdentifier = identifier.trim();
  if (trimmedIdentifier && /^_+$/.test(trimmedIdentifier)) {
    if (trimmedIdentifier.length >= 13) {
      return ["밑줄 아트 감성은 좋지만, 소재 별명은 글자로 지어 주세요."];
    }
    return ["소재별명에 _는 사용할 수 없어요."];
  }
  if (identifier.includes("_")) {
    return ["소재별명에 _는 사용할 수 없어요."];
  }
  const nonUnderscoreLength = trimmedIdentifier.replace(/_/g, "").length;
  if (nonUnderscoreLength >= 13) {
    return ["소재 별명은 12자 이하로 지어 주세요."];
  }
  return [];
}

function sanitizeStateByCurrentConfig(s) {
  const next = { ...s };
  const dropped = [];

  if (next.format && !FORMAT_OPTIONS.includes(next.format)) {
    next.format = "";
    dropped.push("포맷");
  }
  if (next.product && !PRODUCT.flat.includes(next.product)) {
    next.product = "";
    dropped.push("제품");
  }
  if (next.concept && !CONCEPT_OPTIONS.includes(next.concept)) {
    next.concept = "";
    next.subConcept = "";
    dropped.push("소재 컨셉");
  }

  const hasSub = CONCEPTS_WITH_SUBCONCEPT.has(next.concept);
  if (!hasSub && next.subConcept) {
    next.subConcept = "";
    dropped.push("세부 컨셉");
  } else if (hasSub && next.subConcept) {
    const subOptions = SUB_CONCEPT_MAP[next.concept]?.options || [];
    if (!subOptions.includes(next.subConcept)) {
      next.subConcept = "";
      dropped.push("세부 컨셉");
    }
  }

  if (next.version && !VERSION_OPTIONS.includes(next.version)) {
    next.version = FIELD_DEFAULTS.version;
    dropped.push("버전");
  }
  if (next.date && !parseYYMMDD(next.date)) {
    next.date = todayYYMMDD();
    dropped.push("날짜");
  }

  return { next, dropped: [...new Set(dropped)] };
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
      h(
        "span",
        {
          className:
            subOptions && value && subOptions.has(value)
              ? "material-symbols-rounded trigger-sub-icon"
              : "material-symbols-rounded trigger-sub-icon trigger-sub-icon--hidden",
        },
        "tune",
      ),
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
            placeholder: "검색어 입력",
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
    warnings,
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
      warnings && warnings.length > 0
        ? h(InlineWarning, { warnings, className: "inline-input-warning" })
        : null,
    ),
  );
};

const InlineWarning = ({ warnings, className = "" }) =>
  h(
    "button",
    {
      className: `output-warning-inline bulk-prompt-dropdown is-warning ${className}`.trim(),
      type: "button",
      tabIndex: -1,
    },
    h("span", { className: "material-symbols-rounded" }, "warning"),
    h(
      "span",
      { className: "output-warning-parts bulk-prompt-parts" },
      ...warnings.flatMap((msg, i) => [
        ...(i > 0
          ? [h("span", { className: "output-warning-sep bulk-prompt-sep" }, "·")]
          : []),
        h("span", { className: "output-warning-part bulk-prompt-part" }, msg),
      ]),
    ),
  );

const OutputDisplay = (props) => {
  const { result } = props;

  if (result.status === "waiting") {
    return h("div", { className: "output output--waiting" }, result.message);
  }
  if (result.status === "missing") {
    return h(
      "div",
      { className: "output output--missing" },
      h("div", { className: "output-missing-label" }, "다음 태그를 채워 주세요"),
      h(
        "div",
        { className: "output-missing-chips" },
        ...result.missing.map(({ key, label }) =>
          h(
            "button",
            {
              className: "output-missing-chip",
              type: "button",
              "data-field-key": key,
              onClick: handleMissingFieldClick,
              title: `${label} 입력으로 이동`,
            },
            label,
          ),
        ),
      ),
    );
  }
  if (result.status === "error") {
    return h("div", { className: "output output--error" }, result.message);
  }
  if (result.status === "invalid") {
    return h(
      "div",
      { className: "output output--error" },
      "소재 별명을 수정하면 소재명을 생성할 수 있어요.",
    );
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
        "전체 복사",
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
    h("p", { className: "share-heading" }, "소재명이 생성됐어요!"),
    h(
      "p",
      { className: "share-subtext" },
      "링크를 공유하면 공유받은 사람도 같은 소재명을 바로 확인할 수 있어요",
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
          onClick: handleClearHistoryClick,
          tabIndex: -1,
          type: "button",
          title: "내역 삭제",
        },
        h("span", { className: "material-symbols-rounded" }, "delete_sweep"),
        "전체 삭제",
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

const DP_MONTH_NAMES = [
  "1월",
  "2월",
  "3월",
  "4월",
  "5월",
  "6월",
  "7월",
  "8월",
  "9월",
  "10월",
  "11월",
  "12월",
];
const DP_DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

const DatePickerField = ({ value }) => {
  const todayStr = todayYYMMDD();
  const firstDay = new Date(datePickerViewYear, datePickerViewMonth, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(
    datePickerViewYear,
    datePickerViewMonth + 1,
    0,
  ).getDate();

  const prevMonth = datePickerViewMonth === 0 ? 11 : datePickerViewMonth - 1;
  const prevYear =
    datePickerViewMonth === 0 ? datePickerViewYear - 1 : datePickerViewYear;
  const nextMonth = datePickerViewMonth === 11 ? 0 : datePickerViewMonth + 1;
  const nextYear =
    datePickerViewMonth === 11 ? datePickerViewYear + 1 : datePickerViewYear;
  const daysInPrevMonth = new Date(prevYear, prevMonth + 1, 0).getDate();

  // Only render as many rows as the month actually needs (4, 5, or 6)
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  const cells = Array.from({ length: totalCells }, (_, i) => {
    let day, year, month, inMonth;
    if (i < startOffset) {
      day = daysInPrevMonth - startOffset + 1 + i;
      year = prevYear;
      month = prevMonth;
      inMonth = false;
    } else if (i < startOffset + daysInMonth) {
      day = i - startOffset + 1;
      year = datePickerViewYear;
      month = datePickerViewMonth;
      inMonth = true;
    } else {
      day = i - startOffset - daysInMonth + 1;
      year = nextYear;
      month = nextMonth;
      inMonth = false;
    }
    const cellStr = toYYMMDD(new Date(year, month, day));
    const cls = [
      "dp-day",
      !inMonth ? "dp-day--out" : "",
      cellStr === value ? "dp-day--selected" : "",
      cellStr === todayStr ? "dp-day--today" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return h(
      "button",
      { className: cls, type: "button", "data-date": cellStr, tabIndex: -1 },
      String(day),
    );
  });

  return h(
    "div",
    { className: "field-row" },
    h(
      "label",
      { className: "field-label" },
      h(
        "span",
        { className: "material-symbols-rounded field-icon" },
        "calendar_today",
      ),
      "날짜",
      h(
        "span",
        { className: "field-tooltip" },
        "날짜를 선택하면 소재명에 포함돼요",
      ),
    ),
    h(
      "div",
      { className: "datepicker-container" },
      h(
        "button",
        {
          className: datePickerOpen
            ? "dropdown-trigger open"
            : "dropdown-trigger",
          type: "button",
          onClick: handleDatePickerToggle,
        },
        h(
          "span",
          {
            className: value ? "dropdown-value" : "dropdown-value placeholder",
          },
          value || "날짜 미포함",
        ),
        h(
          "span",
          {
            className: value
              ? "dropdown-clear"
              : "dropdown-clear dropdown-clear--hidden",
            onClick: handleClearDate,
          },
          h("span", { className: "material-symbols-rounded" }, "close"),
        ),
        h(
          "span",
          { className: "material-symbols-rounded dropdown-chevron" },
          "expand_more",
        ),
      ),
      datePickerOpen
        ? h(
          "div",
          { className: "datepicker-panel" },
          h(
            "div",
            { className: "dp-header" },
            h(
              "button",
              {
                className: "dp-nav-btn",
                type: "button",
                onClick: handleDatePickerPrevMonth,
                tabIndex: -1,
              },
              h(
                "span",
                { className: "material-symbols-rounded" },
                "chevron_left",
              ),
            ),
            h(
              "span",
              { className: "dp-month-label" },
              `${datePickerViewYear}년 ${DP_MONTH_NAMES[datePickerViewMonth]}`,
            ),
            h(
              "button",
              {
                className: "dp-nav-btn",
                type: "button",
                onClick: handleDatePickerNextMonth,
                tabIndex: -1,
              },
              h(
                "span",
                { className: "material-symbols-rounded" },
                "chevron_right",
              ),
            ),
          ),
          h(
            "div",
            { className: "dp-grid", onClick: handleDatePickerGridClick },
            ...DP_DAY_NAMES.map((d) =>
              h("div", { className: "dp-weekday" }, d),
            ),
            ...cells,
          ),
        )
        : null,
    ),
  );
};

const ClearHistoryModal = () =>
  h(
    "div",
    { className: "modal-overlay", onClick: handleClearHistoryModalBackdrop },
    h(
      "div",
      { className: "modal-dialog" },
      h("h2", { className: "modal-title" }, "최근 복사 내역을 모두 삭제할까요?"),
      h(
        "p",
        { className: "modal-body" },
        "삭제한 내역은 복구할 수 없어요",
      ),
      h(
        "div",
        { className: "modal-actions" },
        h(
          "button",
          {
            type: "button",
            className: "modal-cancel",
            onClick: handleCancelClearHistory,
          },
          "취소",
        ),
        h(
          "button",
          {
            type: "button",
            className: "modal-confirm",
            onClick: handleConfirmClearHistory,
          },
          "전체 삭제",
        ),
      ),
    ),
  );

function App() {
  const s = state.get();
  const hasSubConcept = CONCEPTS_WITH_SUBCONCEPT.has(s.concept);
  const subConceptEntry = SUB_CONCEPT_MAP[s.concept];
  const subConceptOptions = subConceptEntry?.options ?? [];
  const subConceptGroups = subConceptEntry?.groups ?? null;
  const result = buildName(s);
  const blockingWarnings = getBlockingWarnings(s);
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
            "몇 가지 선택만으로 광고 소재명을 빠르게 만들 수 있어요",
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
            tooltip: "소재의 파일 유형을 선택해 주세요",
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
            tooltip: "소재가 실제로 노출하는 상품을 선택해 주세요",
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
            tooltip: "소재의 중심이 되는 컨셉을 선택해 주세요",
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
              label: "세부 컨셉",
              icon: "tune",
              fieldName: "subConcept",
              value: s.subConcept,
              options: subConceptOptions,
              onToggle: toggleSubConcept,
              onMenuClick: handleSubConceptMenuClick,
              onClear: handleClearSubConcept,
              tooltip: "선택한 컨셉을 더 세부적으로 구분할 때 사용해요",
              searchable: true,
              onFilterInput: handleSubConceptFilterInput,
              groups: subConceptGroups,
            }),
          ),
          h(InputField, {
            label: "소재 별명",
            icon: "badge",
            value: s.identifier,
            onInput: handleIdentifierInput,
            onBlur: handleIdentifierBlur,
            onFocus: handleIdentifierFocus,
            onKeyDown: handleIdentifierKeyDown,
            placeholder: "예: 바이럴, 여름세일, 블프",
            tooltip: "내부 소통을 위해 붙이는 소재 별명이에요",
            suggestions: identifierSuggestionsOpen
              ? getIdentifierSuggestions()
              : [],
            highlightIdx: identifierHighlight,
            warnings: blockingWarnings.length > 0 ? blockingWarnings : null,
          }),
          h(VersionStepper, {
            value: s.version,
            tooltip: "같은 소재의 버전이에요 (기본값은 v1이에요)",
          }),
          h(DatePickerField, { value: s.date }),
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
    ),
    confirmClearHistoryOpen ? h(ClearHistoryModal, {}) : null,
  );
}

// ============================================================
// INIT
// ============================================================

const pageContentEl = document.getElementById("page-content");
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

const bootstrapCache = readConfigCache();
if (pageContentEl && !hasFreshCache(bootstrapCache)) {
  pageContentEl.innerHTML = `
    <div class="app-loading">
      <div class="app-loading-card">
        <div class="app-loading-spinner" aria-hidden="true"></div>
        <h2 class="app-loading-title">소재명 생성기를 준비하고 있어요</h2>
        <p class="app-loading-copy">서버 설정을 확인한 뒤 화면을 열어드릴게요.</p>
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

async function loadGeneratorConfig(seedCache = null) {
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

let latestConfigVersion = bootstrapCache?.version ?? null;
let generatorRevalidateInFlight = false;

function applyGeneratorConfig(data, opts = {}) {
  const { announceSync = false } = opts;
  FORMAT_OPTIONS = data.format;
  PRODUCT = parseMixedOptions(data.product);
  CONCEPT = parseMixedOptions(data.concept.options);
  CONCEPT_GROUPS = CONCEPT.groups;
  CONCEPT_OPTIONS = CONCEPT.flat;
  SUB_CONCEPT_MAP = Object.fromEntries(
    Object.entries(data.concept.subConcepts).map(([name, def]) => {
      const { flat, groups } = parseMixedOptions(def);
      return [name, { options: flat, groups }];
    }),
  );
  CONCEPTS_WITH_SUBCONCEPT = new Set(Object.keys(SUB_CONCEPT_MAP));
  VERSION_OPTIONS = Array.from({ length: data.versionMax }, (_, i) => `v${i + 1}`);

  const currentState = state.get();
  const { next, dropped } = sanitizeStateByCurrentConfig(currentState);
  const changed = URL_FIELDS.some((k) => next[k] !== currentState[k]);
  if (changed) {
    state.set({ ...currentState, ...next, openDropdown: null });
  }

  if (!root) {
    if (pageContentEl) pageContentEl.innerHTML = "";
    root = createRoot(document.getElementById("page-content"));
    state.subscribe(() => {
      syncStateToURL(state.get());
      root.render(App());
    });
    syncStateToURL(state.get());
    root.render(App());
  } else {
    rerender();
  }

  if (dropped.length > 0) {
    showToast(`${dropped.join(", ")} 값이 현재 목록에 없어 초기화했어요.`);
  } else if (announceSync) {
    showToast("최신 설정을 반영했어요.");
  }
}

async function revalidateGeneratorConfig(force = false) {
  if (generatorRevalidateInFlight) return;
  if (!force && document.visibilityState === "hidden") return;
  generatorRevalidateInFlight = true;
  try {
    const meta = await fetchConfigMeta();
    if (latestConfigVersion !== null && Number(meta.version) === Number(latestConfigVersion)) {
      return;
    }
    const cached = readConfigCache();
    if (cached && Number(cached.version) === Number(meta.version) && isValidConfigData(cached.data)) {
      latestConfigVersion = cached.version;
      writeConfigCache(cached);
      return;
    }
    const fresh = await fetchConfigWithOptionalEtag(cached);
    writeConfigCache(fresh);
    latestConfigVersion = fresh.version ?? latestConfigVersion;
    applyGeneratorConfig(fresh.data, { announceSync: true });
  } catch (e) {
    // Keep current UI as-is on background revalidation failure.
  } finally {
    generatorRevalidateInFlight = false;
  }
}

loadGeneratorConfig(bootstrapCache)
  .then((data) => {
    latestConfigVersion = readConfigCache()?.version ?? latestConfigVersion;
    applyGeneratorConfig(data);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        revalidateGeneratorConfig(true);
      }
    });
  })
  .catch(() => {
    if (pageContentEl) {
      pageContentEl.innerHTML = `
        <div class="app-loading">
          <div class="app-loading-card">
            <h2 class="app-loading-title">데이터 로딩에 실패했어요</h2>
            <p class="app-loading-copy">잠시 후 새로고침 해주세요.</p>
          </div>
        </div>
      `;
    }
  });
