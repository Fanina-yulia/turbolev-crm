"use client";

import { ClientCardDrawer as ClientCardDrawerCore } from "./client-card-drawer-core";
import { BinotelPhoneCalls } from "./binotel-phone-calls";

type Props = {
  open: boolean;
  name: string;
  phone?: string;
  channel?: string;
  existingLeadId?: string;
  onClose: () => void;
  onCreateLead: () => void;
};

export function ClientCardDrawer(props: Props) {
  return <>
    <ClientCardDrawerCore {...props} />
    {props.open && props.phone ? <BinotelPhoneCalls phone={props.phone} /> : null}
  </>;
}
