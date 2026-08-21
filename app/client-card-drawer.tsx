"use client";

import { ClientCardDrawer as ClientCardDrawerCore } from "./client-card-drawer-core";
import { BinotelPhoneCalls } from "./binotel-phone-calls";
import { CommunicationsCardConsistencyEnhancer } from "./communications-card-consistency-enhancer";

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
    <CommunicationsCardConsistencyEnhancer open={props.open} name={props.name} phone={props.phone} channel={props.channel} />
    <ClientCardDrawerCore {...props} />
    {props.open && props.phone ? <BinotelPhoneCalls phone={props.phone} /> : null}
  </>;
}