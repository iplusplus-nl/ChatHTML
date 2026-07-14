export function shouldDismissMessageEditor(
  isEditing: boolean,
  canEdit: boolean
): boolean {
  return isEditing && !canEdit;
}
