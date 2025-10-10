import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface CustomerDetailItem {
  label: string;
  value: string | null;
  category: string;
}

interface CustomerDetailsPanelProps {
  details: CustomerDetailItem[];
}

export function CustomerDetailsPanel({ details }: CustomerDetailsPanelProps) {
  const categories = Array.from(new Set(details.map((d) => d.category)));

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">Customer Details</h2>
      <ScrollArea className="h-[300px]">
        <div className="space-y-6">
          {categories.map((category) => (
            <div key={category} className="space-y-3">
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                {category}
              </h3>
              <div className="space-y-2">
                {details
                  .filter((d) => d.category === category)
                  .map((detail, idx) => (
                    <div
                      key={idx}
                      className="flex justify-between items-start gap-4"
                      data-testid={`detail-${detail.label.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      <span className="text-sm text-muted-foreground">
                        {detail.label}
                      </span>
                      <span className="text-sm font-medium text-right">
                        {detail.value || "—"}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
