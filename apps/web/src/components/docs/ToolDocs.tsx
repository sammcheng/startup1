import CodeBlock from "@/components/docs/CodeBlock";
import type { ToolDocumentation } from "@/types/docs";

interface ToolDocsProps {
  docs: ToolDocumentation;
}

export default function ToolDocs({ docs }: ToolDocsProps) {
  return (
    <section className="space-y-8">
      <div>
        <div className="text-xs uppercase tracking-[0.25em] text-stone-500">API Reference</div>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-100">Call this tool through the HackMarket gateway</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-400">
          Use your HackMarket API key, send a JSON payload that matches the request schema, and the platform will route the call to the seller&apos;s live tool.
        </p>
      </div>

      <div className="rounded-[28px] border border-stone-800 bg-stone-950/80 p-6 shadow-xl shadow-black/20">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-stone-500">Live endpoint</div>
            <div className="mt-2 break-all rounded-2xl border border-stone-800 bg-stone-900/80 px-4 py-3 font-mono text-sm text-sky-200">
              {docs.endpoint_url}
            </div>
          </div>
          <a
            href="#demo"
            className="inline-flex items-center justify-center rounded-full bg-sky-300 px-5 py-3 text-sm font-semibold text-stone-950 transition hover:bg-sky-200"
          >
            Try It
          </a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title={docs.authentication.title} body={docs.authentication.body} />
        <SectionCard title={docs.rate_limit.title} body={docs.rate_limit.body} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <JsonCard title="Request example" description={docs.request_format.body} value={docs.request_example} />
        <JsonCard title="Response example" description={docs.response_format.body} value={docs.response_example} />
      </div>

      <CodeBlock examples={docs.code_examples} />

      <section className="rounded-[28px] border border-stone-800 bg-stone-950/80 p-6 shadow-xl shadow-black/20">
        <div className="text-xs uppercase tracking-[0.25em] text-stone-500">Errors</div>
        <h3 className="mt-2 text-2xl font-semibold text-stone-100">Common responses</h3>
        <div className="mt-5 overflow-hidden rounded-3xl border border-stone-800">
          <div className="grid grid-cols-[0.4fr_0.8fr_1.8fr] gap-4 bg-stone-900/80 px-5 py-3 text-xs uppercase tracking-[0.2em] text-stone-400">
            <div>Status</div>
            <div>Code</div>
            <div>Meaning</div>
          </div>
          <div className="divide-y divide-stone-800">
            {docs.error_codes.map((error) => (
              <div key={`${error.status}-${error.code}`} className="grid grid-cols-[0.4fr_0.8fr_1.8fr] gap-4 px-5 py-4 text-sm">
                <div className="font-medium text-stone-100">{error.status}</div>
                <div className="font-mono text-amber-200">{error.code}</div>
                <div className="text-stone-300">{error.meaning}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </section>
  );
}

function SectionCard(props: { title: string; body: string }) {
  return (
    <section className="rounded-[28px] border border-stone-800 bg-stone-950/80 p-6 shadow-xl shadow-black/20">
      <div className="text-xs uppercase tracking-[0.25em] text-stone-500">{props.title}</div>
      <p className="mt-3 text-sm leading-7 text-stone-300">{props.body}</p>
    </section>
  );
}

function JsonCard(props: { title: string; description: string; value: unknown }) {
  return (
    <section className="rounded-[28px] border border-stone-800 bg-stone-950/80 p-6 shadow-xl shadow-black/20">
      <div className="text-xs uppercase tracking-[0.25em] text-stone-500">{props.title}</div>
      <p className="mt-3 text-sm leading-6 text-stone-400">{props.description}</p>
      <pre className="mt-4 overflow-x-auto rounded-3xl border border-stone-800 bg-[#09111a] p-5 text-sm leading-7 text-emerald-200">
        <code>{JSON.stringify(props.value, null, 2)}</code>
      </pre>
    </section>
  );
}
