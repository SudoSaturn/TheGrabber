import { Toast } from "@raycast/api";
import { Form, ActionPanel, Action, showToast } from "@raycast/api";
import React, { useState } from "react";
import fs from "fs";
import { UploadMagnetParams, uploadMagnet } from "./utils/api";

export default function Command() {
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(files: UploadMagnetParams) {
    try {
      setIsLoading(true);
      const magnetResponse = await uploadMagnet(files);
      setIsLoading(false);

      if (magnetResponse.status === "error") {
        showToast({ title: "Unable to grab magnet", style: Toast.Style.Failure });
        console.log(magnetResponse);
        return;
      }

      showToast({ title: "Magnet grabbed !" });
    } catch (e) {
      setIsLoading(false);
      console.log(e);
      showToast({ title: "Something went wrong :(" , style: Toast.Style.Failure });
    }
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        (
          <ActionPanel>
            {
              (
                <Action.SubmitForm
                  title="Submit Magnet Files"
                  onSubmit={(values: { files: string[] }) => {
                    const files = values.files
                      .filter((file: any) => fs.existsSync(file) && fs.lstatSync(file).isFile())
                      .map((file) => fs.createReadStream(file));

                    handleSubmit({ files });
                  }}
                />
              ) as any
            }
          </ActionPanel>
        ) as any
      }
    >
      {
        (
          <Form.FilePicker id="files" title="Select Magnet Files" />
        ) as any
      }
    </Form>
  );
}
