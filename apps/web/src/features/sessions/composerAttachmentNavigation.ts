export type ComposerAttachmentNavigationDependencies = {
  clearAttachments(): Promise<void>;
  onClearError?(error: unknown): void;
};

export function discardComposerAttachmentsAndRun<T>(
  dependencies: ComposerAttachmentNavigationDependencies,
  action: () => T | Promise<T>
): T | Promise<T> {
  try {
    void dependencies
      .clearAttachments()
      .catch((error) => dependencies.onClearError?.(error));
  } catch (error) {
    dependencies.onClearError?.(error);
  }

  return action();
}
