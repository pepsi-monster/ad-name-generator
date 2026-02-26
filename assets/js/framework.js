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
