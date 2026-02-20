// ============================================================
// FRAMEWORK
// ============================================================

function h(elType, elProps = {}, ...elChildren) {
  const _elChildren = elChildren.map((child) => {
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
      dom[attribute] = value;
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

  newPropsArr.forEach((attribute) => {
    if (
      (!oldPropsArr.includes(attribute) ||
        oldProps[attribute] !== newProps[attribute]) &&
      !excluded.has(attribute)
    )
      dom[attribute] = newProps[attribute];
  });

  oldPropsArr.forEach((attribute) => {
    if (!newPropsArr.includes(attribute) && !excluded.has(attribute))
      dom.removeAttribute(attribute);
  });
};

const diff = function (oldVNode, newVNode, parent) {
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
// DATA
// ============================================================

const FORMAT_OPTIONS = ["비디오", "이미지"];

const PRODUCT_OPTIONS = [
  "ALL",
  "M1",
  "파인버블",
  "브러시",
  "쓸림쏙",
  "파인셔스",
  "카사업",
];

const CONCEPT_OPTIONS = [
  "감성",
  "기능",
  "대세감",
  "리뷰",
  "문제해결",
  "비교",
  "인물",
  "인플루언서",
  "일반인",
  "정보",
  "할인",
  "공감형",
];

const INFLUENCER_OPTIONS = [
  "나노",
  "마이크로",
  "미드티어",
  "매크로",
  "준메가",
  "메가",
];

const FUNCTION_OPTIONS = [
  "보습",
  "진정",
  "미백",
  "탄력",
  "커버",
  "지속력",
  "각질",
  "광채",
  "휴대성",
  "올인원",
  "대용량",
  "펌프형",
  "이지워시",
  "퀵",
  "흡수력",
  "끈적임없음",
  "발림성",
  "향",
  "무향",
  "순함",
  "비건",
  "성분",
  "가성비",
  "사은품",
  "한정판",
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
  "제형",
  "하루한알",
  "고함량",
  "유기농",
  "2in1",
  "클렌징",
  "탈모",
];

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

const state = createStore({
  format: "",
  product: "",
  concept: "",
  subConcept: "",
  identifier: "",
  version: "",
  spec: "",
  openDropdown: null, // which field's dropdown is open
});

// ============================================================
// HANDLERS
// ============================================================

// Dropdown open/close
function toggleDropdown(fieldName) {
  const current = state.get().openDropdown;
  state.set({
    ...state.get(),
    openDropdown: current === fieldName ? null : fieldName,
  });
}

// Select an option and close the dropdown.
// Uses event delegation: the handler reads data-value from the clicked option element,
// so the closure never goes stale even when option lists change.
function selectOption(fieldName, value) {
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
function toggleSpec() {
  toggleDropdown("spec");
}

// Stable menu click handlers — use event delegation via data-value JS property
function onMenuClick(fieldName, e) {
  const optionEl = e.target.closest(".dropdown-option");
  if (!optionEl) return;
  const val = optionEl["data-value"];
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
function handleSpecMenuClick(e) {
  onMenuClick("spec", e);
}

// Text input
function handleIdentifierInput(e) {
  state.set({ ...state.get(), identifier: e.target.value });
}

// Copy — reads fresh from state, no stale closure
function handleCopy() {
  const result = buildName(state.get());
  if (result.status === "success") {
    navigator.clipboard.writeText(result.name);
    showToast("광고 소재 파일명이 복사되었습니다.");
  }
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
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
    state.set({ ...state.get(), openDropdown: null });
  }
});

// ============================================================
// LOGIC
// ============================================================

function buildName(fields) {
  const { format, product, concept, subConcept, identifier, version, spec } =
    fields;
  const hasSubCategory = CONCEPTS_WITH_SUBCONCEPT.has(concept);

  // State 1: Nothing filled
  const allEmpty =
    !format &&
    !product &&
    !concept &&
    !subConcept &&
    !identifier &&
    !version &&
    !spec;
  if (allEmpty) {
    return { status: "waiting", message: "설정값 입력을 대기중입니다..." };
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
        { value: spec, label: "규격" },
      ]
    : [
        { value: format, label: "포맷" },
        { value: product, label: "제품" },
        { value: concept, label: "소재 컨셉" },
        { value: identifier, label: "소재 고유 식별자" },
        { value: version, label: "버전" },
        { value: spec, label: "규격" },
      ];

  const missing = requiredFields.filter((f) => !f.value).map((f) => f.label);
  if (missing.length > 0) {
    return {
      status: "missing",
      message: `다음 필수 항목이 누락되었습니다:\n${missing.join(", ")}`,
    };
  }

  // State 4: Success
  const conceptPart = hasSubCategory ? `${concept}[${subConcept}]` : concept;
  const name = [format, product, conceptPart, identifier, version, spec].join(
    "_",
  );
  return { status: "success", name };
}

// ============================================================
// COMPONENTS
// ============================================================

// Custom dropdown — always renders the menu in the DOM, toggles visibility via CSS class.
// Options use event delegation (onMenuClick on the menu div) so we never get stale
// per-option click handlers when the option list changes (e.g. 인플루언서 → 기능).
const CustomDropdown = (props) => {
  const { fieldName, value, options, onToggle, onMenuClick } = props;
  const isOpen = state.get().openDropdown === fieldName;

  return h(
    "div",
    { className: "dropdown-container" },
    h(
      "button",
      {
        className: isOpen ? "dropdown-trigger open" : "dropdown-trigger",
        onClick: onToggle,
        type: "button",
      },
      h(
        "span",
        { className: value ? "dropdown-value" : "dropdown-value placeholder" },
        value || "선택",
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
        className: isOpen ? "dropdown-menu open" : "dropdown-menu",
        onClick: onMenuClick,
      },
      ...options.map((opt) =>
        h(
          "div",
          {
            className:
              value === opt ? "dropdown-option selected" : "dropdown-option",
            "data-value": opt,
          },
          h("span", { className: "option-label" }, opt),
          h(
            "span",
            { className: "material-symbols-rounded check-icon" },
            "check",
          ),
        ),
      ),
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
    h(CustomDropdown, { fieldName, value, options, onToggle, onMenuClick }),
  );
};

// Labeled row wrapping the free text input
const InputField = (props) => {
  const { label, icon, onInput, placeholder, tooltip } = props;
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
      onInput,
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
    return h("div", { className: "output output--missing" }, result.message);
  }

  return h(
    "div",
    { className: "output output--success" },
    h("div", { className: "output-name" }, result.name),
    h("button", { className: "copy-btn", onClick: handleCopy }, "복사"),
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
  const result = buildName(s);

  return h(
    "div",
    { id: "app" },
    h(
      "header",
      { className: "app-header" },
      h("h1", { className: "app-title" }, "소재명 생성기"),
      h(
        "p",
        { className: "app-subtitle" },
        "광고 소재 파일명을 자동으로 조합합니다",
      ),
    ),
    h(
      "main",
      {},
      h(
        "div",
        { className: "card" },
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
            tooltip: "소재의 유형 — 비디오 또는 이미지",
          }),
          h(DropdownField, {
            label: "제품",
            icon: "inventory_2",
            fieldName: "product",
            value: s.product,
            options: PRODUCT_OPTIONS,
            onToggle: toggleProduct,
            onMenuClick: handleProductMenuClick,
            tooltip: "광고할 제품명",
          }),
          h(DropdownField, {
            label: "소재 컨셉",
            icon: "lightbulb",
            fieldName: "concept",
            value: s.concept,
            options: CONCEPT_OPTIONS,
            onToggle: toggleConcept,
            onMenuClick: handleConceptMenuClick,
            tooltip: "소재의 크리에이티브 방향",
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
              tooltip: "인플루언서 규모 또는 기능 키워드",
            }),
          ),
          h(InputField, {
            label: "소재 고유 식별자",
            icon: "badge",
            onInput: handleIdentifierInput,
            placeholder: "예: 바이럴, 완전커버",
            tooltip: "소재를 구분하는 고유 이름이나 키워드",
          }),
          h(DropdownField, {
            label: "버전",
            icon: "history",
            fieldName: "version",
            value: s.version,
            options: VERSION_OPTIONS,
            onToggle: toggleVersion,
            onMenuClick: handleVersionMenuClick,
            tooltip: "동일 소재의 반복 제작 순번",
          }),
          h(DropdownField, {
            label: "규격",
            icon: "aspect_ratio",
            fieldName: "spec",
            value: s.spec,
            options: SPEC_OPTIONS,
            onToggle: toggleSpec,
            onMenuClick: handleSpecMenuClick,
            tooltip: "광고 노출 화면 비율",
          }),
        ),
        h("div", { className: "divider" }),
        h(OutputDisplay, { result }),
      ),
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

const root = createRoot(document.body);
state.subscribe(() => root.render(App()));
root.render(App());
