interface GroupingMessage {
  senderId?: string;
  sender_id?: string;
  senderName?: string;
  timestamp?: string | number | Date | null;
}

const GROUP_INTERVAL_MS = 10 * 60 * 1000;

function areGrouped(current: GroupingMessage, neighbor?: GroupingMessage | null): boolean {
  if (!neighbor || current.timestamp == null || neighbor.timestamp == null) return false;
  const sender = current.senderId || current.sender_id || current.senderName;
  const neighborSender = neighbor.senderId || neighbor.sender_id || neighbor.senderName;
  if (!sender || sender !== neighborSender) return false;

  const date = new Date(current.timestamp);
  const neighborDate = new Date(neighbor.timestamp);
  return Number.isFinite(date.getTime()) && Number.isFinite(neighborDate.getTime()) &&
    date.toDateString() === neighborDate.toDateString() &&
    Math.abs(date.getTime() - neighborDate.getTime()) < GROUP_INTERVAL_MS;
}

/** Keep bubble corners, sender names and avatars on the same date-aware grouping rules. */
export function getMessageGrouping(current: GroupingMessage, previous?: GroupingMessage | null, next?: GroupingMessage | null) {
  return {
    isFirstInGroup: !areGrouped(current, previous),
    isLastInGroup: !areGrouped(current, next)
  };
}
