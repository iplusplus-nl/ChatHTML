import {
  getCapabilityConfirmLabel,
  getCapabilityPreview,
  getCapabilityTitle,
  type PreviewCapabilityAction
} from "../features/artifacts/previewCapabilityModel";

export type ArtifactCapabilityStatus = {
  kind: "success" | "error";
  message: string;
};

export type ArtifactCapabilityPanelProps = {
  action: PreviewCapabilityAction | null;
  status: ArtifactCapabilityStatus | null;
  onCancel(): void;
  onConfirm(): void;
};

export function ArtifactCapabilityPanel({
  action,
  status,
  onCancel,
  onConfirm
}: ArtifactCapabilityPanelProps) {
  return (
    <>
      {action ? (
        <div className="artifact-capability-panel" role="dialog" aria-modal="false">
          <strong>{getCapabilityTitle(action)}</strong>
          {action.label ? <span>{action.label}</span> : null}
          <code>{getCapabilityPreview(action)}</code>
          <div className="artifact-capability-actions">
            <button
              className="artifact-capability-secondary"
              type="button"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="artifact-capability-primary"
              type="button"
              onClick={onConfirm}
            >
              {getCapabilityConfirmLabel(action)}
            </button>
          </div>
        </div>
      ) : null}
      {status ? (
        <div
          className={`artifact-capability-status is-${status.kind}`}
          role={status.kind === "error" ? "alert" : "status"}
        >
          {status.message}
        </div>
      ) : null}
    </>
  );
}
