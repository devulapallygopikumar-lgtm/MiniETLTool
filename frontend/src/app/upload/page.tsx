import { redirect } from "next/navigation";

// Upload now lives beside the datasets grid on the home page.
export default function UploadRedirect() {
  redirect("/");
}
