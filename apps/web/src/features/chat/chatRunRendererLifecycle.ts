import type {
  RenderSnapshot,
  StreamingRenderer
} from "../../runtime/streamui/types";
import { projectStreamingChatRun } from "./chatRunPresentation";

export type SubscribeRestoredChatRunRendererInput = {
  renderer: StreamingRenderer;
  rawStream?: string;
  onSnapshot(snapshot: RenderSnapshot): void;
};

export function subscribeRestoredChatRunRenderer({
  renderer,
  rawStream = "",
  onSnapshot
}: SubscribeRestoredChatRunRendererInput): () => void {
  const initialProjection = projectStreamingChatRun(rawStream);
  const hasInitialStreamUi = initialProjection.streamUiSource !== undefined;

  if (hasInitialStreamUi) {
    renderer.replace(initialProjection.streamUiSource ?? "");
  }

  let receivedInitialSnapshot = false;
  return renderer.onSnapshot((snapshot) => {
    if (!receivedInitialSnapshot) {
      receivedInitialSnapshot = true;
      if (!hasInitialStreamUi) {
        return;
      }
    }
    onSnapshot(snapshot);
  });
}
