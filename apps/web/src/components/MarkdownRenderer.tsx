import { Children, isValidElement, type ComponentProps } from 'react';
import Markdown, { type Components, type Options } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import { remarkMathCompatibility } from '../lib/markdownMath';
import {
  markdownUrlTransform,
  normalizeMarkdownPreview,
  normalizeMarkdownTitle,
  normalizeMarkdownUrl,
} from '../lib/markdownPolicy';

const remarkPlugins: NonNullable<Options['remarkPlugins']> = [
  [remarkGfm, { singleTilde: false }],
  remarkMath,
  remarkMathCompatibility,
  remarkBreaks,
];

const markdownSanitizeSchema: typeof defaultSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-./u, 'math-inline', 'math-display']],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https'],
  },
};

const rehypePlugins: NonNullable<Options['rehypePlugins']> = [
  [rehypeSanitize, markdownSanitizeSchema],
  [rehypeKatex, {
    errorColor: '#a8463d',
    maxExpand: 1000,
    maxSize: 20,
    strict: 'ignore',
    trust: false,
  }],
];

const inlineDisallowedElements = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'pre', 'hr', 'img', 'a', 'input',
];

function MarkdownTable({ children }: ComponentProps<'table'>) {
  return (
    <div className="markdown-table-scroll" role="region" aria-label="可横向滚动的 Markdown 表格" tabIndex={0}>
      <table>{children}</table>
    </div>
  );
}

function MarkdownCodeBlock({ children, ...props }: ComponentProps<'pre'>) {
  const codeElement = Children.toArray(children).find(isValidElement<{ className?: string }>);
  const language = /(?:^|\s)language-([^\s]+)/u.exec(codeElement?.props.className || '')?.[1];

  return (
    <div className={`markdown-code-block${language ? ' has-language' : ''}`}>
      {language && <div className="markdown-code-block__language">{language}</div>}
      <pre {...props}>{children}</pre>
    </div>
  );
}

function markdownHeading(level: 1 | 2 | 3 | 4 | 5 | 6) {
  const Tag = level === 1 ? 'h3' : level === 2 ? 'h4' : level === 3 ? 'h5' : 'h6';
  return function MarkdownHeading({ children, className, node: _node, ...props }: ComponentProps<'h1'> & { node?: unknown }) {
    return <Tag {...props} className={`markdown-heading markdown-heading--${level}${className ? ` ${className}` : ''}`}>{children}</Tag>;
  };
}

const markdownComponents: Components = {
  a({ children, href, title }) {
    const safeHref = normalizeMarkdownUrl(href, 'link');
    if (!safeHref) return <span className="markdown-link--blocked">{children}</span>;
    const external = /^https?:/iu.test(safeHref);
    return (
      <a
        href={safeHref}
        title={title}
        target={external ? '_blank' : undefined}
        rel={external ? 'noreferrer noopener' : undefined}
      >
        {children}
      </a>
    );
  },
  h1: markdownHeading(1),
  h2: markdownHeading(2),
  h3: markdownHeading(3),
  h4: markdownHeading(4),
  h5: markdownHeading(5),
  h6: markdownHeading(6),
  img({ alt, src, title }) {
    const safeSrc = normalizeMarkdownUrl(typeof src === 'string' ? src : '', 'image');
    if (!safeSrc) {
      return <span className="markdown-image--blocked" role="img" aria-label={alt || '图片地址不可用'}>{alt || '图片地址不可用'}</span>;
    }
    return (
      <img
        src={safeSrc}
        alt={alt || ''}
        title={title}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
    );
  },
  pre({ children, node: _node, ...props }) {
    return <MarkdownCodeBlock {...props}>{children}</MarkdownCodeBlock>;
  },
  table({ children }) {
    return <MarkdownTable>{children}</MarkdownTable>;
  },
};

function MarkdownInline({ source }: { source: string }) {
  return (
    <span className="markdown-inline">
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        disallowedElements={inlineDisallowedElements}
        skipHtml
        unwrapDisallowed
        urlTransform={markdownUrlTransform}
      >
        {source}
      </Markdown>
    </span>
  );
}

export function MarkdownRenderer({ source }: { source: string }) {
  return (
    <div className="markdown-body">
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
        skipHtml
        urlTransform={markdownUrlTransform}
      >
        {source}
      </Markdown>
    </div>
  );
}

export function MarkdownTitle({ source }: { source: string }) {
  return <MarkdownInline source={normalizeMarkdownTitle(source)} />;
}

export function MarkdownPreview({ source }: { source: string }) {
  return <MarkdownInline source={normalizeMarkdownPreview(source)} />;
}
