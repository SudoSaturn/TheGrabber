import { Action, ActionPanel, List, Toast, open, showToast } from "@raycast/api";
import React, { Fragment, useEffect, useState } from "react";
import { AsyncData, Result } from "@swan-io/boxed";
import { formatBytes } from "./utils/helpers";
import { Magnet, deleteSavedMagnet, getSavedMagnets, saveLink } from "./utils/api";
import { debridUrl } from "./utils/api";

export default function Command() {
  const [savedLinksRequest, setSavedLinksRequest] = useState(AsyncData.NotAsked<Result<Magnet[], string>>());

  const fetchMagnets = async () => {
    setSavedLinksRequest(AsyncData.Loading);
    const res = await getSavedMagnets();
    setSavedLinksRequest(AsyncData.Done(res));
  };

  const deleteMagnet = async (linkUrl: string) => {
    try {
      await deleteSavedMagnet(linkUrl);
      showToast({ title: "Magnet deleted !" });
      await fetchMagnets();
    } catch (e) {
      console.log(e);
      showToast({ title: "Unable to delete magnet", style: Toast.Style.Failure });
    }
  };

  const saveMagnetLink = async (link: string) => {
    try {
      await saveLink(link);
      showToast({ title: "Magnet saved !" });
    } catch (e) {
      console.log(e);
      showToast({ title: "Unable to save magnet", style: Toast.Style.Failure });
    }
  };

  const downloadMagnetLink = async (link: string) => {
    try {
      const debridedUrl = await debridUrl(link);

      debridedUrl.match({
        Ok: (link) => {
          open(link);
        },
        Error: () => {
          showToast({ title: "Unable to download magnet", style: Toast.Style.Failure });
        },
      });
    } catch (e) {
      console.log(e);
      showToast({ title: "Unable to download magnet", style: Toast.Style.Failure });
    }
  };

  useEffect(() => {
    fetchMagnets();
  }, []);

  return (
    <List isShowingDetail={true} isLoading={savedLinksRequest.isLoading()}>
      {savedLinksRequest.match({
        NotAsked: () => (<List.EmptyView /> as any),
        Loading: () => (<List.EmptyView /> as any),
        Done: (results) => {
          return results.match({
            Ok: (magnets) => {
              return (
                <Fragment>
                  {magnets.map((magnet) => {
                    return (
                      <List.Item
                        key={magnet.filename}
                        title={magnet.filename}
                        detail={
                          (
                            <List.Item.Detail
                              metadata={
                                (
                                  <List.Item.Detail.Metadata>
                                    {(<List.Item.Detail.Metadata.Label title="Filename" text={magnet.filename} />) as any}
                                    {(<List.Item.Detail.Metadata.Separator />) as any}
                                    {(<List.Item.Detail.Metadata.Label title="Size" text={`${formatBytes(magnet.size)}`} />) as any}
                                    {(<List.Item.Detail.Metadata.Separator />) as any}
                                    {(<List.Item.Detail.Metadata.Label title="Status" text={magnet.status} />) as any}
                                    {(<List.Item.Detail.Metadata.Separator />) as any}
                                    {(<List.Item.Detail.Metadata.Label title="Links Available" text={`${magnet.links.length}`} />) as any}
                                  </List.Item.Detail.Metadata>
                                ) as any
                              }
                            />
                          ) as any
                        }
                        actions={
                          (
                            <ActionPanel>
                              {magnet.links.length > 0 ? (
                                <>
                                  {(<Action.OpenInBrowser url={magnet.links[0].link} />) as any}
                                  {(
                                    <Action
                                      title={"Save To My Links Folder"}
                                      onAction={() => {
                                        saveMagnetLink(magnet.links[0].link);
                                      }}
                                    />
                                  ) as any}
                                  {(
                                    <Action
                                      title={"Download"}
                                      onAction={() => {
                                        downloadMagnetLink(magnet.links[0].link);
                                      }}
                                    />
                                  ) as any}
                                </>
                              ) : null}

                              {(
                                <ActionPanel.Section>
                                  {(
                                    <Action
                                      title="Delete This Magnet"
                                      onAction={() => {
                                        deleteMagnet(magnet.id.toString());
                                      }}
                                    />
                                  ) as any}
                                </ActionPanel.Section>
                              ) as any}
                            </ActionPanel>
                          ) as any
                        }
                      />
                    ) as any;
                  })}
                </Fragment>
              ) as any;
            },
            Error: () => {
              return (<List.EmptyView title="An error occured while loading magnets" /> as any);
            },
          });
        },
      }) as any}
    </List>
  );
}
