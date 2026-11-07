export function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key.startsWith('on')) {
            node.addEventListener(key.slice(2), value);
        } else if (key in node && key !== 'list') {
            node[key] = value;
        } else {
            node.setAttribute(key, value);
        }
    }
    node.append(...children.flat().filter((child) => child != null));
    return node;
}

export function field(label, input) {
    return el('label', {className: 'field'}, el('span', {}, label), input);
}
