/**
 * Sanitized teaching snippet. Not production Brand Messenger engine code.
 * Guard: stable platformPostId as doc_src_id.
 */
export function toDocument(message: { platformPostId: string; text: string }): {
  network: string;
  doc_src_id: string;
  text: string;
} {
  return {
    network: "brand-messenger",
    doc_src_id: message.platformPostId,
    text: message.text,
  };
}
