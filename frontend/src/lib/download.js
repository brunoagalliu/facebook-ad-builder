// Plain `<a href={crossOriginUrl} download>` doesn't work for our media: uploads are
// served from the API's own origin (ads.unwaveringmedia.com), not the frontend's
// (ads-ui.unwaveringmedia.com), and browsers ignore the `download` attribute for
// cross-origin links with no Content-Disposition: attachment header — clicking just
// navigates to/opens the file instead of saving it. Fetching the bytes ourselves and
// downloading via a same-origin blob: URL sidesteps that restriction entirely.
export async function downloadFile(url, filename) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
}
