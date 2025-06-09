// @ts-ignore: No type definitions for webtorrent
import WebTorrent from "webtorrent";
import path from "path";
import fs from "fs";
import archiver from "archiver";

// Types for callback and torrent objects are not available in webtorrent, so we use any
export async function downloadMagnetAndZip(
  magnetURI: string,
  outDir: string,
  onProgress?: (progress: number, downloaded: number, total: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const client: any = new WebTorrent();
    client.add(magnetURI, { path: outDir }, async (torrent: any) => {
      const files: string[] = torrent.files.map((f: any) => f.path);
      torrent.on("download", () => {
        if (onProgress) {
          const downloaded: number = torrent.downloaded;
          const total: number = torrent.length;
          const progress: number = total > 0 ? downloaded / total : 0;
          onProgress(progress, downloaded, total);
        }
      });
      torrent.on("done", async () => {
        client.destroy();
        // Zip all files
        const zipPath = path.join(outDir, `magnet-download-${Date.now()}.zip`);
        const output = fs.createWriteStream(zipPath);
        const archive = archiver("zip", { zlib: { level: 9 } });
        archive.pipe(output);
        files.forEach((file: string) => {
          const fullPath = path.join(outDir, file);
          if (fs.existsSync(fullPath)) {
            archive.file(fullPath, { name: file });
          }
        });
        await archive.finalize();
        resolve(zipPath);
      });
      torrent.on("error", (err: any) => {
        client.destroy();
        reject(err);
      });
    });
  });
}
