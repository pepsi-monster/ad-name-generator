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
// DATA
// ============================================================

const FORMAT_OPTIONS = ["비디오", "이미지", "캐러셀"];

const PRODUCT_OPTIONS = [
  "ALL",
  { label: "Refa", items: ["M1", "파인버블", "브러시", "카사업"] },
  { label: "Like Eat", items: ["쓸림쏙", "파인셔스"] },
];

// Parses a mixed definition (plain strings + {label, items} objects) into
// a flat options array for filtering and a groups array for rendering.
// Standalone strings become a null-label group (rendered without a header).
function parseMixedOptions(def) {
  const standalone = def.filter((x) => typeof x === "string");
  const grouped = def.filter((x) => typeof x !== "string");
  const flat = [...standalone, ...grouped.flatMap((g) => g.items)];
  const groups = [
    ...(standalone.length ? [{ label: null, items: standalone }] : []),
    ...grouped,
  ];
  return { flat, groups };
}

const PRODUCT = parseMixedOptions(PRODUCT_OPTIONS);

const CONCEPT_GROUPS = [
  { label: "인물/공감", items: ["인물", "인플루언서", "일반인", "공감형"] },
  { label: "정보/설득", items: ["기능", "정보", "리뷰", "문제해결", "비교"] },
  { label: "감성/퍼포먼스", items: ["감성", "대세감", "할인"] },
];
const CONCEPT_OPTIONS = CONCEPT_GROUPS.flatMap((g) => g.items);

const INFLUENCER_OPTIONS = [
  "나노",
  "마이크로",
  "미드티어",
  "매크로",
  "준메가",
  "메가",
];

const FUNCTION_GROUPS = [
  {
    label: "피부 효능",
    items: ["보습", "진정", "미백", "탄력", "커버", "지속력", "각질", "광채"],
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
  {
    label: "가격/혜택",
    items: ["가성비", "사은품", "한정판"],
  },
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
];
const FUNCTION_OPTIONS = FUNCTION_GROUPS.flatMap((g) => g.items);

const VERSION_OPTIONS = [
  "v1",
  "v2",
  "v3",
  "v4",
  "v5",
  "v6",
  "v7",
  "v8",
  "v9",
  "v10",
];

const SPEC_OPTIONS = ["1x1", "4x5", "9x16", "16x9"];

const CONCEPTS_WITH_SUBCONCEPT = new Set(["인플루언서", "기능"]);

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

function stateFromURL() {
  const p = new URLSearchParams(location.search);
  const s = { openDropdown: null };
  URL_FIELDS.forEach((k) => {
    s[k] = p.get(k) || "";
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

// Session copy history — newest first, cleared on page reload.
let copyHistory = [];
const COPY_HISTORY_MAX = 20;

function addToCopyHistory(label, name) {
  copyHistory = [{ label, name }, ...copyHistory].slice(0, COPY_HISTORY_MAX);
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
      return s.concept === "기능" ? FUNCTION_GROUPS : null;
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
      options =
        s.concept === "인플루언서"
          ? INFLUENCER_OPTIONS
          : s.concept === "기능"
            ? FUNCTION_OPTIONS
            : [];
      break;
    case "version":
      options = VERSION_OPTIONS;
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

// Select an option and close the dropdown.
// Uses event delegation: the handler reads data-value from the clicked option element,
// so the closure never goes stale even when option lists change.
function selectOption(fieldName, value) {
  clearFilter(fieldName);
  const updates = { ...state.get(), [fieldName]: value, openDropdown: null };
  if (fieldName === "concept") updates.subConcept = "";
  state.set(updates);
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
function toggleVersion() {
  toggleDropdown("version");
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
function handleClearVersion(e) {
  e.stopPropagation();
  selectOption("version", "");
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
function handleVersionMenuClick(e) {
  onMenuClick("version", e);
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

// Text input
function handleIdentifierInput(e) {
  state.set({ ...state.get(), identifier: e.target.value });
}

function handleIdentifierBlur(e) {
  saveIdentifierToHistory(e.target.value);
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

// Copy handlers — read name from element property so they never go stale

function handleVariantCopy(e) {
  const name = e.currentTarget.getAttribute("data-copy-text");
  const label = e.currentTarget.getAttribute("data-copy-label");
  if (name) {
    navigator.clipboard.writeText(name);
    addToCopyHistory(label || "", name);
    showToast("복사되었어요", name);
  }
}

function handleHistoryItemCopy(e) {
  const name = e.currentTarget.getAttribute("data-copy-text");
  if (name) {
    navigator.clipboard.writeText(name);
    showToast("복사되었어요", name);
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
    showToast("복사됨", variant.name);
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
    !format && !product && !concept && !subConcept && !identifier && !version;
  if (allEmpty) {
    return { status: "waiting", message: "설정값 입력을 대기중이에요..." };
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
        { value: version, label: "버전" },
      ]
    : [
        { value: format, label: "포맷" },
        { value: product, label: "제품" },
        { value: concept, label: "소재 컨셉" },
        { value: identifier, label: "소재 고유 식별자" },
        { value: version, label: "버전" },
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
    ...SPEC_OPTIONS.map((spec) => ({ label: spec, name: `${base}_${spec}` })),
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

// Labeled row wrapping the free text input
// Labeled row wrapping the free text input
const InputField = (props) => {
  // 1. Add 'value' to your destructured props
  const { label, icon, value, onInput, onBlur, placeholder, tooltip } = props;
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
    h("input", {
      className: "field-input",
      type: "text",
      value: value, // 2. Bind the state value to the input element
      onInput,
      onBlur,
      placeholder,
    }),
  );
};

const OutputDisplay = (props) => {
  const { result } = props;

  if (result.status === "waiting") {
    return h("div", { className: "output output--waiting" }, result.message);
  }
  if (result.status === "error") {
    return h("div", { className: "output output--error" }, result.message);
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

  return h(
    "div",
    { className: "output output--success" },
    h(
      "div",
      { className: "output-variants" },
      ...result.variants.map(({ label, name }, i) =>
        h(
          "div",
          {
            className:
              i === 0
                ? "output-variant output-variant--base"
                : "output-variant",
          },
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
              title: "복사",
            },
            h(
              "span",
              { className: "material-symbols-rounded" },
              "content_copy",
            ),
          ),
        ),
      ),
    ),
  );
};

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
      "최근 복사",
    ),
    h(
      "div",
      { className: "history-list" },
      ...history.map(({ label, name }) =>
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
              title: "복사",
            },
            h(
              "span",
              { className: "material-symbols-rounded" },
              "content_copy",
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
  const subConceptOptions =
    s.concept === "인플루언서"
      ? INFLUENCER_OPTIONS
      : s.concept === "기능"
        ? FUNCTION_OPTIONS
        : [];
  const subConceptGroups = s.concept === "기능" ? FUNCTION_GROUPS : null;
  const result = buildName(s);
  currentVariants = result.status === "success" ? result.variants : [];

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
            "몇 가지 선택만으로 광고 소재명을 만들어드려요",
          ),
        ),

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
            value: s.identifier, // Add this line to pass the state down
            onInput: handleIdentifierInput,
            onBlur: handleIdentifierBlur,
            placeholder: "예: 바이럴, 여름세일, 블프",
            tooltip: "내부 소통을 위해 붙이는 소재의 짧은 별명",
          }),
          h(DropdownField, {
            label: "버전",
            icon: "history",
            fieldName: "version",
            value: s.version,
            options: VERSION_OPTIONS,
            onToggle: toggleVersion,
            onMenuClick: handleVersionMenuClick,
            onClear: handleClearVersion,
            tooltip: "해당 소재의 버전을 입력하는 항목",
          }),
        ),
        h("div", { className: "divider" }),
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
        "View on GitHub",
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
