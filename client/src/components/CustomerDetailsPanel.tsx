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
  // Filter out internal/technical categories like TaxEntities (raw JSON)
  const userFriendlyDetails = details.filter(
    (d) => d.category.toUpperCase() !== "TAXENTITIES"
  );
  
  const categories = Array.from(new Set(userFriendlyDetails.map((d) => d.category)));

  if (userFriendlyDetails.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-medium">Customer Details</h2>
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">
            No details extracted yet. Upload tax documents to populate this section.
          </p>
        </div>
      </div>
    );
  }

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
                {userFriendlyDetails
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
