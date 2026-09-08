/** Convert version entries in a Markdown history section to native disclosures.
 * Operates on parsed Markdown, never raw HTML or fenced-code text. The original
 * source remains readable in Markdown viewers that do not run this plugin.
 */
const DOCUMENT_VERSION_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export default function remarkVersionHistory() {
  return tree => {
    const output = [];
    let inHistory = false;
    let entry;
    for (const node of tree.children) {
      if (node.type === 'heading' && node.depth <= 2) {
        inHistory = node.depth === 2 && node.children.length === 1
          && node.children[0].type === 'text' && node.children[0].value === '版本歷史';
        entry = undefined;
      }
      if (inHistory && node.type === 'heading' && node.depth === 3
        && node.children[0]?.type === 'text' && DOCUMENT_VERSION_RE.test(node.children[0].value.split(/\s/, 1)[0])) {
        entry = {
          type: 'versionHistoryEntry',
          data: { hName: 'details', hProperties: { className: ['morrowise-version-entry'] } },
          children: [{ type: 'paragraph', data: { hName: 'summary' }, children: node.children }],
        };
        output.push(entry);
      } else if (entry) {
        entry.children.push(node);
      } else {
        output.push(node);
      }
    }
    tree.children = output;
  };
}
