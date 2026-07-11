export function ProfileAvatar({
  avatarDataUrl,
  size = "sidebar"
}: {
  avatarDataUrl: string;
  size?: "sidebar" | "settings";
}) {
  return (
    <span className={`profile-avatar is-${size}`} aria-hidden="true">
      {avatarDataUrl ? <img src={avatarDataUrl} alt="" /> : null}
    </span>
  );
}
