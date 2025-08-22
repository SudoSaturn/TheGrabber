import {
  Action,
  ActionPanel,
  Clipboard,
  Form,
  List,
  Toast,
  showToast,
} from "@raycast/api";
import React, { useEffect, useState } from "react";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import { debridUrl } from "./utils/api";
import { getPreferenceValues } from "@raycast/api";
import archiver from "archiver";

interface Preferences {
  apikey: string;
  downloadir: string;
}

const preferences = getPreferenceValues<Preferences>();
const DOWNLOADS_DIR =
  preferences.downloadir || path.join(process.env.HOME || "~", "Downloads");
const HISTORY_FILE = path.join(
  process.env.HOME || "~",
  ".download-history.json"
);

function extractLinks(text: string): string[] {
  const regex = /(https?:\/\/[^\s"']+)/gi;
  const matches = text.match(regex) || [];

  const urls = matches
    .map((url) => url.trim())
    .filter((url) => {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    });

  console.log(`[extractLinks] Found ${urls.length} links:`, urls);
  return urls;
}

function wrapAlldebridLink(url: string): string {
  if (url.startsWith("https://alldebrid.com/f/")) {
    return `https://alldebrid.com/service?url=${encodeURIComponent(url)}`;
  }
  return url;
}

export default function Command() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    async function fetchClipboard() {
      try {
        const clipboardText = await Clipboard.readText();
        if (clipboardText) {
          const foundLinks = extractLinks(clipboardText);
          if (foundLinks.length > 0) {
            console.log(
              `[Clipboard] Found ${foundLinks.length} links in clipboard`
            );
            setInput(foundLinks.join("\n"));
          }
        }
      } catch (error) {
        console.error("Error reading clipboard:", error);
      }
    }

    if (!input) {
      fetchClipboard();
    }
  }, []);

  useEffect(() => {
    if (showHistory) {
      if (fs.existsSync(HISTORY_FILE)) {
        const content = fs.readFileSync(HISTORY_FILE, "utf-8");
        setHistory(JSON.parse(content));
      } else {
        setHistory([]);
      }
    }
  }, [showHistory]);

  function handleShowHistory() {
    setShowHistory(true);
  }
  function handleShowDownload() {
    setShowHistory(false);
  }

  if (showHistory) {
    return (
      <List
        isLoading={false}
        searchBarPlaceholder="Search downloads..."
        actions={
          (
            <ActionPanel>
              {
                (
                  <Action
                    title="Back to Download"
                    onAction={handleShowDownload}
                  />
                ) as any
              }
            </ActionPanel>
          ) as any
        }
      >
        {
          history.map((entry, idx) => {
            const fullFilename =
              entry.title || path.basename(entry.output || "");
            const filenameWithoutExt = fullFilename.replace(/\.[^/.]+$/, "");

            let fileSize = "";
            try {
              if (entry.output && fs.existsSync(entry.output)) {
                const stats = fs.statSync(entry.output);
                fileSize = (stats.size / (1024 * 1024)).toFixed(2) + " MB";
              }
            } catch (err) {
              console.error("Error getting file size:", err);
            }

            const downloadDate = new Date(entry.date);
            const dateString = downloadDate.toLocaleDateString();
            const timeString = downloadDate.toLocaleTimeString();

            return (
              <List.Item
                key={idx}
                title={filenameWithoutExt}
                subtitle={`${dateString} ${timeString} · ${fileSize}`}
                accessories={[{ date: downloadDate }]}
                detail={
                  (
                    <List.Item.Detail
                      markdown={`**File:** ${fullFilename}\n\n**Size:** ${fileSize}\n\n**Date:** ${dateString} ${timeString}\n\n**Path:** ${entry.output}`}
                    />
                  ) as any
                }
              />
            );
          }) as any
        }
      </List>
    );
  }

  async function handleSubmit() {
    setLoading(true);
    const linkList = extractLinks(input);
    if (linkList.length === 0) {
      showToast({ title: "No links found", style: Toast.Style.Failure });
      setLoading(false);
      return;
    }

    const uniqueLinks = [...new Set(linkList)];
    if (uniqueLinks.length < linkList.length) {
      const duplicateCount = linkList.length - uniqueLinks.length;
      showToast({
        title: `${duplicateCount} duplicate link(s) found`,
        message: "Duplicate links will be processed only once",
        style: Toast.Style.Animated,
      });
    }

    let history: any[] = [];
    if (fs.existsSync(HISTORY_FILE)) {
      try {
        history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
      } catch (err) {
        console.error("Error reading history file:", err);
      }
    }

    if (!fs.existsSync(DOWNLOADS_DIR)) {
      fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    }

    try {
      const downloadedFiles: string[] = [];
      const downloadedFilenames: string[] = [];

      for (const link of uniqueLinks) {
        try {
          const previousDownload = history.find(
            (entry) => Array.isArray(entry.links) && entry.links.includes(link)
          );

          if (previousDownload) {
            const confirmToast = await showToast({
              title: "Link was previously downloaded",
              message: `Downloaded on ${new Date(
                previousDownload.date
              ).toLocaleDateString()}. Re-downloading...`,
              style: Toast.Style.Animated,
              primaryAction: {
                title: "Cancel",
                onAction: () => {
                  showToast({
                    title: "Download cancelled",
                    style: Toast.Style.Failure,
                  });
                  return Promise.reject("Download cancelled by user");
                },
              },
            });
          }

          console.log(`[Processing] Unlocking link: ${link}`);
          try {
            const result = await debridUrl(link);
            console.log(`[debridUrl] Result:`, result);

            if (result.isOk()) {
              const downloadUrl = result.value;
              console.log(`[Success] Got download URL: ${downloadUrl}`);

              let filename = path.basename(new URL(downloadUrl).pathname);
              if (!filename || filename === "/") {
                filename = `download-${Date.now()}.bin`;
              }

              filename = decodeURIComponent(filename);
              console.log(`[Download] Starting download of: ${filename}`);

              const filePath = await downloadFile(downloadUrl, filename);
              console.log(`[Download] Completed: ${filePath}`);

              downloadedFiles.push(filePath);
              downloadedFilenames.push(filename);

              if (uniqueLinks.length === 1) {
                showToast({
                  title: "Download complete!",
                  message: filePath,
                  style: Toast.Style.Success,
                });
              } else {
                showToast({
                  title: `Download ${downloadedFiles.length}/${uniqueLinks.length} complete`,
                  message: filename,
                  style: Toast.Style.Success,
                });
              }
            } else {
              console.error(`[Error] Failed to unlock link: ${link}`, result);
              const errorMessage = result.isError()
                ? result.getError()
                : "Unknown error";
              showToast({
                title: "Failed to unlock link",
                message: `${link}: ${errorMessage}`,
                style: Toast.Style.Failure,
              });
            }
          } catch (err: any) {
            console.error(`[Error] Exception during link processing:`, err);
            if (err === "Download cancelled by user") continue;
            showToast({
              title: "Download error",
              message: err.message || "Unknown error occurred",
              style: Toast.Style.Failure,
            });
          }
        } catch (err: any) {
          if (err === "Download cancelled by user") continue;
          console.error(`[Error] Outer catch - Download error:`, err);
          showToast({
            title: "Download error",
            message: err.message || "Unknown error occurred",
            style: Toast.Style.Failure,
          });
        }
      }

      if (downloadedFiles.length > 1) {
        const zipToast = await showToast({
          title: "Zipping files",
          message: `Combining ${downloadedFiles.length} files into a single archive...`,
          style: Toast.Style.Animated,
        });

        const zipFilename = `alldebrid-downloads-${Date.now()}.zip`;
        const zipFilePath = path.join(DOWNLOADS_DIR, zipFilename);

        await zipFiles(downloadedFiles, zipFilePath);

        saveHistory({
          date: new Date().toISOString(),
          title: zipFilename,
          links: uniqueLinks,
          output: zipFilePath,
          containedFiles: downloadedFilenames,
        });

        zipToast.hide();
        showToast({
          title: "All downloads complete!",
          message: `${downloadedFiles.length} files zipped to ${zipFilename}`,
          style: Toast.Style.Success,
        });

        downloadedFiles.forEach((file) => {
          try {
            fs.unlinkSync(file);
          } catch (err) {
            console.error(`Failed to delete ${file}:`, err);
          }
        });
      } else if (downloadedFiles.length === 1) {
        const filePath = downloadedFiles[0];
        const filename = downloadedFilenames[0];

        saveHistory({
          date: new Date().toISOString(),
          title: filename,
          links: uniqueLinks,
          output: filePath,
        });
      }
    } catch (err: any) {
      showToast({
        title: "Error processing downloads",
        message: err.message,
        style: Toast.Style.Failure,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Form
      actions={
        (
          <ActionPanel>
            {
              (
                <Action.SubmitForm title="Download" onSubmit={handleSubmit} />
              ) as any
            }
            {
              (
                <Action
                  title="Show Download History"
                  onAction={handleShowHistory}
                />
              ) as any
            }
          </ActionPanel>
        ) as any
      }
    >
      {
        (
          <Form.TextArea
            id="input"
            title="Paste links"
            placeholder="Paste direct links here (one per line)..."
            value={input}
            onChange={setInput}
            autoFocus
          />
        ) as any
      }
    </Form>
  );
}

async function downloadFile(url: string, filename: string) {
  filename = filename.replace(/[/\\?%*:|"<>]/g, "_");
  const filePath = path.join(DOWNLOADS_DIR, filename);
  const writer = fs.createWriteStream(filePath);

  const progressToast = await showToast({
    title: `Downloading ${filename}`,
    message: "Starting download...",
    style: Toast.Style.Animated,
  });

  const realUrl = wrapAlldebridLink(url);
  console.log(`[downloadFile] Downloading from: ${realUrl}`);

  try {
    const response = await axios.get(realUrl, {
      responseType: "stream",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "*/*",
        Referer: "https://alldebrid.com/",
      },
      maxRedirects: 5,
      timeout: 30000,
    });

    let downloadedBytes = 0;
    const totalBytes = parseInt(response.headers["content-length"] || "0");
    let lastProgressUpdate = Date.now();

    response.data.on("data", (chunk: Buffer) => {
      downloadedBytes += chunk.length;

      const now = Date.now();
      if (now - lastProgressUpdate > 500) {
        lastProgressUpdate = now;

        if (totalBytes > 0) {
          const percentage = Math.round((downloadedBytes / totalBytes) * 100);
          const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
          const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
          progressToast.message = `${percentage}% (${downloadedMB}MB / ${totalMB}MB)`;
        } else {
          const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
          progressToast.message = `${downloadedMB}MB downloaded`;
        }
      }
    });

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", (err: Error) => {
        console.error(`[Download] Writer error:`, err);
        progressToast.hide();
        reject(err);
      });
      response.data.on("error", (err: Error) => {
        console.error(`[Download] Stream error:`, err);
        progressToast.hide();
        reject(err);
      });

      const timeout = setTimeout(() => {
        console.error(`[Download] Timeout after 5 minutes`);
        progressToast.hide();
        reject(new Error("Download timed out after 5 minutes"));
      }, 5 * 60 * 1000);

      writer.on("finish", () => clearTimeout(timeout));
    });
  } catch (err) {
    console.error(`[Download] Axios error:`, err);
    progressToast.hide();
    throw err;
  }

  progressToast.hide();

  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`[Download] Finished: ${filePath} (${sizeMB} MB)`);

    if (stats.size < 1024) {
      console.warn(
        `[Warning] Downloaded file is very small: ${stats.size} bytes`
      );
    }

    return filePath;
  } else {
    throw new Error(`File download failed: ${filePath} does not exist`);
  }
}

async function zipFiles(
  filePaths: string[],
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", {
      zlib: { level: 6 },
    });

    output.on("close", () => {
      resolve(outputPath);
    });

    archive.on("error", (err: Error) => {
      reject(err);
    });

    archive.pipe(output);

    for (const filePath of filePaths) {
      if (fs.existsSync(filePath)) {
        const filename = path.basename(filePath);
        archive.file(filePath, { name: filename });
      }
    }

    archive.finalize();
  });
}

function saveHistory(entry: any) {
  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
  }
  history.unshift(entry);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}
