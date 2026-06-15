export function selectActivityUploadItems(items, mode = 'all') {
  const isAvailable = item => !item.needsReselection;
  if (mode === 'failed') return items.filter(item => item.status === 'failed' && isAvailable(item));
  if (mode === 'pending') return items.filter(item => (item.status === 'queued' || item.status === 'preparing') && isAvailable(item));
  return items.filter(item => ['queued', 'preparing', 'failed'].includes(item.status) && isAvailable(item));
}
