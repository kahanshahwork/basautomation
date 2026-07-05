interface Props { title: string; icon: string; desc?: string; }
export function PlaceholderPage({ title, icon, desc }: Props) {
  return (
    <div className="anim-up">
      <div className="page-hdr">
        <div className="page-hdr-left"><h1>{title}</h1></div>
      </div>
      <div className="empty-state">
        <div className="empty-icon">{icon}</div>
        <p className="empty-title">{title}</p>
        <p className="empty-sub">{desc ?? 'Coming soon.'}</p>
      </div>
    </div>
  );
}
