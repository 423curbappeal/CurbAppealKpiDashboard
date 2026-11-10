/** Re-mounts on every navigation, so each screen fades in instead of snapping. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade">{children}</div>;
}
