import { useEffect, useRef, useState } from "react";

export type ProgressStep = 
  | "uploading"
  | "analyzing"
  | "extracting"
  | "matching"
  | "generating"
  | "complete"
  | "error";

export interface ProgressEvent {
  customerId: string;
  uploadId: string;
  step: ProgressStep;
  message: string;
  progress?: number;
}

interface UseProgressWebSocketResult {
  currentStep: ProgressStep | null;
  message: string;
  progress: number;
  isConnected: boolean;
}

export function useProgressWebSocket(customerId: string): UseProgressWebSocketResult {
  const [currentStep, setCurrentStep] = useState<ProgressStep | null>(null);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!customerId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/progress?customerId=${customerId}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected for customer:", customerId);
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const progressEvent: ProgressEvent = JSON.parse(event.data);
        console.log("Progress update received:", progressEvent);
        
        setCurrentStep(progressEvent.step);
        setMessage(progressEvent.message);
        setProgress(progressEvent.progress || 0);

        // Reset progress state when complete or error
        if (progressEvent.step === "complete" || progressEvent.step === "error") {
          setTimeout(() => {
            setCurrentStep(null);
            setMessage("");
            setProgress(0);
          }, 2000); // Keep the complete/error state visible for 2 seconds
        }
      } catch (error) {
        console.error("Error parsing progress event:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      setIsConnected(false);
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected");
      setIsConnected(false);
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [customerId]);

  return {
    currentStep,
    message,
    progress,
    isConnected,
  };
}
