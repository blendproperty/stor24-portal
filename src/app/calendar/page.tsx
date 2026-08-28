import Link from "next/link";
import { CalendarDays, Clock3 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { getOperationsCalendar } from "@/lib/calendar-service";
import { requireScope } from "@/lib/scope";
import { SOUTH_AFRICA_TIME_ZONE } from "@/lib/south-africa-time";

export const metadata = { title: "Calendar" };

const dayLabel = (key: string) => new Intl.DateTimeFormat("en-ZA", { timeZone: SOUTH_AFRICA_TIME_ZONE, weekday: "short", day: "2-digit", month: "short" }).format(new Date(`${key}T12:00:00+02:00`));
const timeLabel = (value: Date) => new Intl.DateTimeFormat("en-ZA", { timeZone: SOUTH_AFRICA_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(value);

export default async function CalendarPage() {
  const days = await getOperationsCalendar(await requireScope());
  return <div className="page-stack">
    <PageHeader eyebrow="Work scheduling" title="Calendar" description="Live facility-scoped tasks, lead follow-ups, viewings and scheduled move-outs in South African time."/>
    <section className="calendar-grid">
      {days.map((day) => <article className="calendar-day" key={day.key}>
        <div><CalendarDays size={18}/><strong>{dayLabel(day.key)}</strong><span>{day.items.length} {day.items.length === 1 ? "item" : "items"}</span></div>
        {day.items.length ? day.items.map((item) => <Link href={item.href} key={`${item.kind}-${item.id}`}><Clock3 size={14}/><span><strong>{timeLabel(item.at)} · {item.title}</strong><small>{item.detail}</small></span></Link>) : <p><Clock3 size={14}/>No scheduled work</p>}
      </article>)}
    </section>
  </div>;
}
