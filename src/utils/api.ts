import { Result } from "@swan-io/boxed";
import axios from "axios";
import { ReadStream } from "fs";
import FormData from "form-data";
import { getPreferenceValues } from "@raycast/api";
import fs from "fs";
import path from "path";

const AGENT_NAME = "Raycast";

// Helper: Add magnet link and poll until ready, then return direct links
export async function resolveMagnet(magnet: string): Promise<Link[]> {
  const { apikey } = getPreferenceValues<Preferences>();
  // 1. Upload magnet link
  const addResp = await axios.get("https://api.alldebrid.com/v4/magnet/upload", {
    params: {
      apikey,
      agent: AGENT_NAME,
      magnet,
    },
  });
  if (addResp.data.status === "error") throw new Error("Failed to add magnet link");
  const magnetId = addResp.data.data.id;
  // 2. Poll status until ready
  let status = "";
  let links: Link[] = [];
  for (let i = 0; i < 30; ++i) { // up to ~30s
    const statusResp = await axios.get("https://api.alldebrid.com/v4/magnet/status", {
      params: {
        apikey,
        agent: AGENT_NAME,
        id: magnetId,
      },
    });
    if (statusResp.data.status === "success") {
      const magnetData = statusResp.data.data.magnets[0];
      status = magnetData.status;
      if (status === "Ready") {
        links = magnetData.links;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (status !== "Ready" || links.length === 0) throw new Error("Magnet not ready or no links found");
  return links;
}

// Fetch and process the /getmagnet/<magnet_id> link
export async function fetchGetMagnetContainer(magnetId: number, outDir: string): Promise<{ filePath: string, contentType: string }> {
  const url = `https://alldebrid.com/getmagnet/${magnetId}`;
  const outPath = path.join(outDir, `getmagnet-${magnetId}`);
  const response = await axios.get(url, {
    responseType: "stream",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "*/*",
      "Referer": "https://alldebrid.com/"
    },
    maxRedirects: 5
  });
  // Try to get filename from Content-Disposition header
  let fileName = undefined;
  const cd = response.headers["content-disposition"];
  if (cd) {
    const match = cd.match(/filename="?([^";]+)"?/);
    if (match) fileName = match[1];
  }
  let filePath = fileName ? path.join(outDir, fileName) : undefined;
  if (!filePath) {
    let ext = "bin";
    if (response.headers["content-type"]?.includes("zip")) ext = "zip";
    else if (response.headers["content-type"]?.includes("octet-stream")) ext = "bin";
    else if (response.headers["content-type"]?.includes("text/plain")) ext = "txt";
    filePath = `${outPath}.${ext}`;
  }
  const writer = fs.createWriteStream(filePath);
  response.data.pipe(writer);
  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
    response.data.on("error", reject);
  });
  return { filePath, contentType: response.headers["content-type"] ?? "" };
}


export type Link = {
  link: string;
  filename: string;
  host: string;
  size: number;
  date: number;
};

type AllDebridSaveResponse = {
  status: "success" | "error";
  data: {
    links: Link[];
  };
};

interface Preferences {
  apikey: string;
}

export const getSavedLinks = async () => {
  const { apikey } = getPreferenceValues<Preferences>();

  try {
    const { data } = await axios.get("https://api.alldebrid.com/v4/user/links", {
      params: {
        apikey: apikey,
        agent: AGENT_NAME,
      },
    });

    const data2 = data as AllDebridSaveResponse;

    if (data2.status === "error") {
      return Result.Error("");
    } else {
      return Result.Ok(data2.data.links);
    }
  } catch (e) {
    console.error(e);
    return Result.Error("");
  }
};

export type Magnet = {
  id: number;
  size: number;
  filename: string;
  status: "Downloading" | "Ready";
  links: Link[];
};

type AllDebridSavedMagnetsResponse = {
  status: "success" | "error";
  data: {
    magnets: Magnet[];
  };
};

export const getSavedMagnets = async () => {
  const { apikey } = getPreferenceValues<Preferences>();

  try {
    const { data } = await axios.get("https://api.alldebrid.com/v4/magnet/status", {
      params: {
        apikey: apikey,
        agent: AGENT_NAME,
      },
    });

    const data2 = data as AllDebridSavedMagnetsResponse;

    if (data2.status === "error") {
      return Result.Error("");
    } else {
      return Result.Ok(data2.data.magnets);
    }
  } catch (e) {
    console.error(e);
    return Result.Error("");
  }
};

type DeletionResponse = {
  status: "success" | "error";
};

export const deleteSavedLink = async (link: string) => {
  const { apikey } = getPreferenceValues<Preferences>();

  try {
    const { data } = await axios.get("https://api.alldebrid.com/v4/user/links/delete", {
      params: {
        apikey: apikey,
        agent: AGENT_NAME,
        link: link,
      },
    });

    const { status } = data as DeletionResponse;

    if (status === "error") {
      return Result.Error("");
    } else {
      return Result.Ok;
    }
  } catch (e) {
    console.error(e);
    return Result.Error("");
  }
};

export const deleteSavedMagnet = async (magnetId: string) => {
  const { apikey } = getPreferenceValues<Preferences>();

  try {
    const { data } = await axios.get("https://api.alldebrid.com/v4/magnet/delete", {
      params: {
        apikey: apikey,
        agent: AGENT_NAME,
        id: magnetId,
      },
    });

    const { status } = data as DeletionResponse;

    if (status === "error") {
      return Result.Error("");
    } else {
      return Result.Ok;
    }
  } catch (e) {
    console.error(e);
    return Result.Error("");
  }
};

type AllDebridFileUpload = {
  name: string;
  error?: {
    code: string;
    message: string;
  };
};
type AllDebridUnlockResponse = {
  status: "success" | "error";
  data: {
    files: AllDebridFileUpload[];
  };
};

export type UploadMagnetParams = {
  files: ReadStream[];
};

export const uploadMagnet = (values: UploadMagnetParams): Promise<AllDebridUnlockResponse> => {
  const { apikey } = getPreferenceValues<Preferences>();
  const formData = new FormData();

  values.files.forEach((file) => {
    formData.append("files[]", file);
  });

  return axios
    .post("https://api.alldebrid.com/v4/magnet/upload/file", formData, {
      params: {
        apikey: apikey,
        agent: AGENT_NAME,
      },
      headers: {
        "Content-Type": "multipart/form-data",
      },
    })
    .then(({ data }) => data);
};

type AllDebridUnlockUrlResponse = {
  status: "success" | "error";
  data: {
    link: string;
  };
};

export const debridUrl = (link: string): Promise<Result<string, string>> => {
  const { apikey } = getPreferenceValues<Preferences>();

  return axios
    .get("https://api.alldebrid.com/v4/link/unlock", {
      params: {
        apikey: apikey,
        link: link,
        agent: AGENT_NAME,
      },
    })
    .then(({ data }) => {
      const {
        status,
        data: { link },
      } = data as AllDebridUnlockUrlResponse;

      if (status === "error") {
        return Result.Error("");
      } else {
        return Result.Ok(link);
      }
    });
};

type AllDebridSaveLinkResponse = {
  status: "success" | "error";
  data: {
    message: string;
  };
};

export const saveLink = (link: string): Promise<AllDebridSaveLinkResponse> => {
  const { apikey } = getPreferenceValues<Preferences>();

  return axios
    .get("https://api.alldebrid.com/v4/user/links/save", {
      params: {
        apikey: apikey,
        links: [link],
        agent: AGENT_NAME,
      },
    })
    .then(({ data }) => data);
};
