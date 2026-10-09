type ProfileRow = { label: string; count: number };
export function MarketProfileSummary({ groups, caption }: { groups: { title: string; rows: ProfileRow[] }[]; caption: string }) {
  return <section className="panel market-profile-summary"><div className="profile-heading"><div><p className="eyebrow">CUSTOMER INTELLIGENCE</p><h2>Customer market profile</h2></div><span className="profile-source">Self-reported enquiries</span></div><p className="leads-caption">{caption}</p><div className="market-profile-grid">{groups.map(group => {
    const total = group.rows.reduce((sum, row) => sum + row.count, 0);
    const unknown = group.rows.filter(row => /unknown|not recorded/i.test(row.label)).reduce((sum,row) => sum + row.count,0);
    return <article key={group.title}><div className="profile-card-heading"><h3>{group.title}</h3><span>{total.toLocaleString()} enquiries</span></div>{group.rows.map(row => <div className="profile-answer" key={row.label}><div><span>{row.label.replaceAll("_", " ").toLowerCase()}</span><strong>{row.count.toLocaleString()} <small>{total ? Math.round(row.count / total * 100) : 0}%</small></strong></div><div className="profile-track" aria-hidden="true"><span className={/unknown|not recorded/i.test(row.label) ? "profile-unknown" : ""} style={{width: `${total ? row.count / total * 100 : 0}%`}}/></div></div>)}<p className="profile-completeness">{total ? Math.round((total - unknown) / total * 100) : 0}% recorded · {unknown.toLocaleString()} unknown</p></article>;
  })}</div></section>;
}

