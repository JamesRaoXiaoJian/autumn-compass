import { findAndReplace, type RegExpMatchObject } from 'mdast-util-find-and-replace';
import type { PhrasingContent, Root, RootContent } from 'mdast';

type MutableParent = RootContent & { children: RootContent[] };

const blockedImplicitMathAncestors = new Set([
  'code',
  'definition',
  'image',
  'imageReference',
  'inlineCode',
  'link',
  'linkReference',
  'math',
  'inlineMath',
]);

// Match a deliberately narrow subset of un-delimited TeX identifiers. The
// established remark-math parser still owns all real math parsing; this only
// promotes tokens such as E_{\mathrm{acc}} or W^\top to an inlineMath node.
// Plain identifiers such as snake_case, E_acc, and filenames do not match.
const implicitDecoratedIdentifier = /(?<![\\/A-Za-z0-9_])(?:[A-Za-z]|\\[A-Za-z]+(?:\{[^{}\r\n]*\})?)(?:(?:[_^])(?:\{(?:[^{}\r\n]|\\[A-Za-z]+(?:\{[^{}\r\n]*\})?)+\}|\\[A-Za-z]+|[A-Za-z0-9]))+(?![\/A-Za-z0-9_])/gu;
const explicitTexCommand = /\\[A-Za-z]+/u;
const strongDisplayMathSignal = /(?:\\[A-Za-z]+|[_^]\s*(?:\{|\\[A-Za-z]+)|\\begin\s*\{)/u;

function displayMathNode(value: string, position?: RootContent['position']): RootContent {
  return {
    type: 'math',
    meta: null,
    value,
    data: {
      hName: 'pre',
      hChildren: [{
        type: 'element',
        tagName: 'code',
        properties: { className: ['language-math', 'math-display'] },
        children: [{ type: 'text', value }],
      }],
    },
    position,
  } as RootContent;
}

function inlineMathNode(value: string): PhrasingContent {
  return {
    type: 'inlineMath',
    value,
    data: {
      hName: 'code',
      hProperties: { className: ['language-math', 'math-inline'] },
      hChildren: [{ type: 'text', value }],
    },
  } as PhrasingContent;
}

function bracketMathValue(source: string): string | null {
  const lines = source.replace(/\r\n?/gu, '\n').split('\n');
  if (lines.length < 3) return null;

  const opening = lines[0].trim();
  const closing = lines.at(-1)?.trim();
  const latexDelimited = opening === '\\[' && closing === '\\]';
  const compatibilityDelimited = opening === '[' && closing === ']';
  if (!latexDelimited && !compatibilityDelimited) return null;

  const value = lines.slice(1, -1).join('\n').trim();
  if (!value) return null;

  // A bare [ ... ] paragraph can also be ordinary prose. Only opt it into
  // math when its body contains an unambiguous TeX/math signal. Explicit
  // LaTeX \[ ... \] delimiters do not need that extra guard.
  if (compatibilityDelimited && !strongDisplayMathSignal.test(value)) return null;
  return value;
}

function upgradeDisplayMath(parent: Root | MutableParent, markdownSource: string) {
  parent.children = parent.children.map((node) => {
    if (node.type === 'paragraph') {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (typeof start === 'number' && typeof end === 'number') {
        const value = bracketMathValue(markdownSource.slice(start, end));
        if (value) {
          return displayMathNode(value, node.position);
        }
      }
    }

    if ('children' in node && Array.isArray(node.children)) {
      upgradeDisplayMath(node as MutableParent, markdownSource);
    }
    return node;
  });
}

function isSafeImplicitMath(value: string, match: RegExpMatchObject) {
  if (!value.includes('{') && !explicitTexCommand.test(value)) return false;
  return !match.stack.some((node) => blockedImplicitMathAncestors.has(node.type));
}

/**
 * Compatibility adapter for common AI/LaTeX-flavoured Markdown.
 *
 * It intentionally produces the same `math` / `inlineMath` MDAST nodes as
 * remark-math. rehype-katex remains the only formula renderer, so this layer
 * does not implement TeX parsing or HTML rendering itself.
 */
export function remarkMathCompatibility() {
  return (tree: Root, file: { value: unknown }) => {
    const markdownSource = typeof file.value === 'string' ? file.value : String(file.value ?? '');
    upgradeDisplayMath(tree, markdownSource);

    findAndReplace(tree, [
      [
        implicitDecoratedIdentifier,
        (value, ...parameters) => {
          const match = parameters.at(-1) as RegExpMatchObject;
          if (!isSafeImplicitMath(value, match)) return false;
          return inlineMathNode(value);
        },
      ],
    ]);
  };
}
