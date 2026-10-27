import ReactMarkdown from 'react-markdown';

// Merchant-written Markdown. Raw HTML is dropped (skipHtml), not executed or shown as text; links open safely.
export function Markdown({ children }: { children: string }) {
  return (
    <div className="flex flex-col gap-3 leading-relaxed [&_a]:underline [&_li]:ml-5 [&_ol]:list-decimal [&_ul]:list-disc">
      <ReactMarkdown
        skipHtml
        components={{
          a: ({ href, children: text }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
              {text}
            </a>
          ),
          img: () => null, // images belong in the carousel, uploaded to our storage
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
