import { WebSocket, WebSocketServer } from "ws";
import { Server } from "http";

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
  progress?: number; // 0-100
}

class ProgressService {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, Set<WebSocket>> = new Map();

  initialize(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/ws/progress" });

    this.wss.on("connection", (ws: WebSocket, req) => {
      console.log("WebSocket client connected");

      // Extract customerId from query params
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const customerId = url.searchParams.get("customerId");

      if (customerId) {
        if (!this.clients.has(customerId)) {
          this.clients.set(customerId, new Set());
        }
        this.clients.get(customerId)!.add(ws);

        console.log(`Client registered for customer: ${customerId}`);
      }

      ws.on("close", () => {
        if (customerId) {
          const customerClients = this.clients.get(customerId);
          if (customerClients) {
            customerClients.delete(ws);
            if (customerClients.size === 0) {
              this.clients.delete(customerId);
            }
          }
        }
        console.log("WebSocket client disconnected");
      });

      ws.on("error", (error) => {
        console.error("WebSocket error:", error);
      });
    });

    console.log("WebSocket server initialized at /ws/progress");
  }

  sendProgress(event: ProgressEvent) {
    const customerClients = this.clients.get(event.customerId);
    
    if (!customerClients || customerClients.size === 0) {
      console.log(`No clients connected for customer ${event.customerId}`);
      return;
    }

    const message = JSON.stringify(event);
    
    customerClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
        console.log(`Progress sent to customer ${event.customerId}:`, event.step);
      }
    });
  }

  close() {
    if (this.wss) {
      this.wss.close();
    }
  }
}

export const progressService = new ProgressService();
