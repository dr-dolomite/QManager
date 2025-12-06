import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { FaCircle } from "react-icons/fa6";
import { MdSignalCellular2Bar } from "react-icons/md";
import { Separator } from "@/components/ui/separator";

const LTEStatusComponent = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold tabular-nums">
          4G Primary Status
        </CardTitle>
        {/* Parent Grid */}
        <div className="grid gap-4">
          <div className="flex items-center justify-between">
            {/* Signal Strength  */}
            <div className="grid gap-0.5">
              <h3 className="text-sm font-semibold">Signal Strength</h3>
              <div className="flex items-center gap-x-1">
                <FaCircle className="text-green-500 w-2 h-2" />
                <p className="text-muted-foreground text-xs">Connected</p>
              </div>
            </div>

            {/* Signal Bar */}
            <MdSignalCellular2Bar className="w-10 h-10 text-primary" />
          </div>
          <div className="grid gap-2">
            {/* Band Name */}
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground text-sm">
                Band
              </p>
              <p className="font-semibold text-sm">B3</p>
            </div>
            {/* EARFCN */}
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground text-sm">
                EARFCN
              </p>
              <p className="font-semibold text-sm">1850</p>
            </div>
            {/* PCI */}
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground text-sm">PCI</p>
              <p className="font-semibold text-sm">100</p>
            </div>
            {/* RSRP */}
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground text-sm">
                RSRP
              </p>
              <p className="font-semibold text-sm">-95 dBm</p>
            </div>

            {/* RSRQ */}
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground text-sm">
                RSRQ
              </p>
              <p className="font-semibold text-sm">-10 dB</p>
            </div>
            {/* RSSI */}
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground text-sm">
                RSSI
              </p>
              <p className="font-semibold text-sm">-65 dBm</p>
            </div>
            {/* SINR */}
            <Separator />
            <div className="flex items-center justify-between">
              <p className="font-semibold text-muted-foreground text-sm">
                SINR
              </p>
              <p className="font-semibold text-sm">20 dB</p>
            </div>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
};

export default LTEStatusComponent;
