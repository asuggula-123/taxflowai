import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, Check, X } from "lucide-react";
import type { DetectedMemory } from "./ChatInterface";

interface MemoryConfirmationProps {
  memories: DetectedMemory[];
  customerId: string | null;
  onConfirm: (memory: DetectedMemory) => void;
  onDismiss: (index: number) => void;
  isPending?: boolean;
}

export function MemoryConfirmation({
  memories,
  customerId,
  onConfirm,
  onDismiss,
  isPending = false,
}: MemoryConfirmationProps) {
  if (memories.length === 0) return null;

  return (
    <Card className="p-3 bg-accent/10 border-accent space-y-2" data-testid="memory-confirmation-card">
      <div className="flex items-start gap-2">
        <Brain className="h-4 w-4 text-accent-foreground mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <p className="text-xs font-medium text-accent-foreground">
            Memory detected - should I remember this?
          </p>
          {memories.map((memory, index) => (
            <div
              key={index}
              className="space-y-1 p-2 bg-background/50 rounded-md"
              data-testid={`memory-item-${index}`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant={memory.type === 'firm' ? 'default' : 'secondary'}
                  className="text-xs"
                  data-testid={`memory-type-${memory.type}`}
                >
                  {memory.type === 'firm' ? 'Firm-wide' : 'Customer-specific'}
                </Badge>
              </div>
              <p className="text-xs text-foreground">{memory.content}</p>
              <p className="text-xs text-muted-foreground italic">{memory.reason}</p>
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => onConfirm(memory)}
                  disabled={isPending}
                  className="h-7 text-xs"
                  data-testid={`button-confirm-memory-${index}`}
                >
                  {isPending ? (
                    <>
                      <Check className="h-3 w-3 mr-1 animate-pulse" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="h-3 w-3 mr-1" />
                      Remember
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onDismiss(index)}
                  disabled={isPending}
                  className="h-7 text-xs"
                  data-testid={`button-dismiss-memory-${index}`}
                >
                  <X className="h-3 w-3 mr-1" />
                  Dismiss
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
