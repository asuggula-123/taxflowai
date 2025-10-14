import { Check, Loader2 } from "lucide-react";

export type ProgressStep = 
  | "uploading"
  | "analyzing"
  | "extracting"
  | "matching"
  | "generating"
  | "complete"
  | "error";

interface ProgressStepsProps {
  currentStep: ProgressStep;
  message: string;
  progress?: number;
}

const steps = [
  { id: "uploading", label: "Uploading document" },
  { id: "analyzing", label: "AI analysis" },
  { id: "extracting", label: "Extracting information" },
  { id: "matching", label: "Matching documents" },
  { id: "generating", label: "Generating recommendations" },
  { id: "complete", label: "Complete" },
] as const;

export function ProgressSteps({ currentStep, message, progress = 0 }: ProgressStepsProps) {
  const currentStepIndex = steps.findIndex(step => step.id === currentStep);
  const isError = currentStep === "error";

  const getStepStatus = (stepIndex: number) => {
    if (isError) return "error";
    if (stepIndex < currentStepIndex) return "completed";
    if (stepIndex === currentStepIndex) return "current";
    return "pending";
  };

  return (
    <div className="space-y-4" data-testid="progress-steps">
      <div className="space-y-2">
        {steps.map((step, index) => {
          const status = getStepStatus(index);
          
          return (
            <div
              key={step.id}
              className="flex items-center gap-3"
              data-testid={`step-${step.id}`}
            >
              <div className="flex-shrink-0">
                {status === "completed" && (
                  <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center" data-testid={`icon-${step.id}-complete`}>
                    <Check className="w-3 h-3 text-primary-foreground" />
                  </div>
                )}
                {status === "current" && (
                  <div className="w-5 h-5" data-testid={`icon-${step.id}-current`}>
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  </div>
                )}
                {status === "pending" && (
                  <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30" data-testid={`icon-${step.id}-pending`} />
                )}
                {status === "error" && (
                  <div className="w-5 h-5 rounded-full border-2 border-destructive" data-testid={`icon-${step.id}-error`} />
                )}
              </div>
              
              <span
                className={`text-sm ${
                  status === "completed"
                    ? "text-foreground font-medium"
                    : status === "current"
                    ? "text-primary font-medium"
                    : status === "error"
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
                data-testid={`label-${step.id}`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              isError ? "bg-destructive" : "bg-primary"
            }`}
            style={{ width: `${progress}%` }}
            data-testid="progress-bar"
          />
        </div>
        <p className="text-sm text-muted-foreground text-center" data-testid="progress-message">
          {message}
        </p>
      </div>
    </div>
  );
}
