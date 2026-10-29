import type { Prisma } from "@prisma/client";
import { calendarKey } from "./dates";
// Reconstruct a past day's membership without rewriting the original reports.
export async function enrollmentIdsOnDate(
  client: Pick<Prisma.TransactionClient, "enrollment" | "studentTransfer">,
  date: string,
  halqaId?: string,
) {
  const active = await client.enrollment.findMany({
    where: { active: true, ...(halqaId ? { halqaId } : {}) },
    select: { id: true, studentId: true },
  });
  const transfers = await client.studentTransfer.findMany({
    where: halqaId
      ? { OR: [{ sourceHalqaId: halqaId }, { targetHalqaId: halqaId }] }
      : {},
    select: { studentId: true, sourceEnrollmentId: true, createdAt: true },
    orderBy: { sequence: "desc" },
  });
  const ids = new Set(active.map((e) => e.id));
  const membership = new Map(active.map((e) => [e.studentId, e.id]));
  for (const t of transfers) {
    if (calendarKey(t.createdAt) <= date) continue;
    const current = membership.get(t.studentId);
    if (current) ids.delete(current);
    ids.add(t.sourceEnrollmentId);
    membership.set(t.studentId, t.sourceEnrollmentId);
  }
  return ids;
}
