/** Минимальный безопасный markdown-рендер: заголовки, списки, ссылки, код, жирный/курсив. */
import { Fragment, ReactNode } from "react";

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let k = 0;
  const pattern = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/;
  while (rest) {
    const m = rest.match(pattern);
    if (!m || m.index === undefined) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const key = `${keyBase}-${k++}`;
    if (m[2]) out.push(<strong key={key}>{m[2]}</strong>);
    else if (m[4]) out.push(<em key={key}>{m[4]}</em>);
    else if (m[6]) out.push(<code key={key}>{m[6]}</code>);
    else if (m[8]) {
      const href = m[9].startsWith("http") ? m[9] : "#";
      out.push(
        <a key={key} href={href} target="_blank" rel="noopener noreferrer">
          {m[8]}
        </a>,
      );
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let key = 0;

  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={`ul-${key++}`}>
          {list.map((item, i) => (
            <li key={i}>{inline(item, `li-${key}-${i}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("- ") || t.startsWith("* ")) {
      list.push(t.slice(2));
      continue;
    }
    flushList();
    if (!t) continue;
    const h = t.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      const Tag = (["h1", "h2", "h3"] as const)[h[1].length - 1];
      blocks.push(<Tag key={`h-${key++}`}>{inline(h[2], `h-${key}`)}</Tag>);
    } else {
      blocks.push(<p key={`p-${key++}`}>{inline(t, `p-${key}`)}</p>);
    }
  }
  flushList();
  return <div className="md-body text-sm">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
