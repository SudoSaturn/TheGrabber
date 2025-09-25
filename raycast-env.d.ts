/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** API Key - Alldebrid api key */
  "apikey": string,
  /** Download Directory - Directory where downloads will be saved (defaults to ~/Downloads) */
  "downloadir"?: string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `downloadLinks` command */
  export type DownloadLinks = ExtensionPreferences & {}
  /** Preferences accessible in the `myMagnets` command */
  export type MyMagnets = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `downloadLinks` command */
  export type DownloadLinks = {}
  /** Arguments passed to the `myMagnets` command */
  export type MyMagnets = {}
}

