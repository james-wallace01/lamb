export function getInitials(user) {
  const first = (user?.firstName || '').toString().trim();
  const last = (user?.lastName || '').toString().trim();
  const a = first ? first[0] : '';
  const b = last ? last[0] : '';
  const initials = `${a}${b}`.toUpperCase();
  return initials || '?';
}
