import { cx } from "@/components/ui/cx";

export type KeyValueRow = { label: string; value: string; href?: string };

/** Label and value rows between hairlines. A value with an `href` is a link that opens elsewhere. */
export function KeyValueFooter({ rows, className }: { rows: readonly KeyValueRow[]; className?: string }) {
  return (
    <dl className={cx("text-[14px]", className)}>
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[minmax(5.5rem,10rem)_1fr] items-baseline gap-x-6 border-t border-rule py-3 last:border-b">
          <dt className="text-muted">{row.label}</dt>
          <dd className="min-w-0 break-words">
            {row.href ? (
              <a href={row.href} {...(row.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="no-underline hover:underline">
                {row.value}
              </a>
            ) : (
              row.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
