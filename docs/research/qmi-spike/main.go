// qmiprobe — read-only QMI NAS spike client over AF_QIPCRTR.
// Stdlib only (no libqmi); cross-compile: GOOS=linux GOARCH=arm64 CGO_ENABLED=0.
// Only sends NAS *Get* requests. Never sends set/config messages.
package main

import (
	"encoding/binary"
	"encoding/hex"
	"flag"
	"fmt"
	"os"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	afQIPCRTR   = 42
	qrtrPortCtl = 0xfffffffe
	ctlNewSrv   = 4
	ctlLookup   = 10
	svcNAS      = 3
)

type sockaddrQrtr struct {
	Family uint16
	_      uint16
	Node   uint32
	Port   uint32
}

var (
	fd      int
	dstNode uint32
	dstPort uint32
	txn     uint16 = 1
	verbose bool
)

func sendto(b []byte, node, port uint32) error {
	sa := sockaddrQrtr{Family: afQIPCRTR, Node: node, Port: port}
	_, _, e := syscall.Syscall6(syscall.SYS_SENDTO, uintptr(fd), uintptr(unsafe.Pointer(&b[0])), uintptr(len(b)), 0, uintptr(unsafe.Pointer(&sa)), unsafe.Sizeof(sa))
	if e != 0 {
		return e
	}
	return nil
}

func recvfrom(b []byte) (int, sockaddrQrtr, error) {
	var sa sockaddrQrtr
	sl := uint32(unsafe.Sizeof(sa))
	n, _, e := syscall.Syscall6(syscall.SYS_RECVFROM, uintptr(fd), uintptr(unsafe.Pointer(&b[0])), uintptr(len(b)), 0, uintptr(unsafe.Pointer(&sa)), uintptr(unsafe.Pointer(&sl)))
	if e != 0 {
		return 0, sa, e
	}
	return int(n), sa, nil
}

func localNode() uint32 {
	var sa sockaddrQrtr
	sl := uint32(unsafe.Sizeof(sa))
	syscall.Syscall(syscall.SYS_GETSOCKNAME, uintptr(fd), uintptr(unsafe.Pointer(&sa)), uintptr(unsafe.Pointer(&sl)))
	return sa.Node
}

// lookup asks the name service for NAS and returns the first server found.
func lookup(svc uint32) (uint32, uint32, bool) {
	pkt := make([]byte, 20)
	binary.LittleEndian.PutUint32(pkt[0:], ctlLookup)
	binary.LittleEndian.PutUint32(pkt[4:], svc)
	if err := sendto(pkt, localNode(), qrtrPortCtl); err != nil {
		fmt.Fprintln(os.Stderr, "lookup send:", err)
		return 0, 0, false
	}
	buf := make([]byte, 256)
	var node, port uint32
	found := false
	for {
		n, _, err := recvfrom(buf)
		if err != nil || n < 20 {
			break
		}
		if binary.LittleEndian.Uint32(buf[0:]) != ctlNewSrv {
			continue
		}
		s := binary.LittleEndian.Uint32(buf[4:])
		if s == 0 {
			break // end of lookup
		}
		if s == svc && !found {
			node = binary.LittleEndian.Uint32(buf[12:])
			port = binary.LittleEndian.Uint32(buf[16:])
			found = true
		}
	}
	return node, port, found
}

type tlv struct {
	T byte
	V []byte
}

// request sends one QMI request and returns response TLVs + round-trip time.
func request(msgID uint16, in []tlv) ([]tlv, time.Duration, error) {
	body := []byte{}
	for _, t := range in {
		h := []byte{t.T, 0, 0}
		binary.LittleEndian.PutUint16(h[1:], uint16(len(t.V)))
		body = append(append(body, h...), t.V...)
	}
	my := txn
	txn++
	pkt := make([]byte, 7, 7+len(body))
	pkt[0] = 0x00 // request
	binary.LittleEndian.PutUint16(pkt[1:], my)
	binary.LittleEndian.PutUint16(pkt[3:], msgID)
	binary.LittleEndian.PutUint16(pkt[5:], uint16(len(body)))
	pkt = append(pkt, body...)
	t0 := time.Now()
	if err := sendto(pkt, dstNode, dstPort); err != nil {
		return nil, 0, err
	}
	buf := make([]byte, 65536)
	for {
		n, sa, err := recvfrom(buf)
		if err != nil {
			return nil, time.Since(t0), err
		}
		if sa.Port != dstPort || n < 7 {
			continue
		}
		if buf[0] != 0x02 || binary.LittleEndian.Uint16(buf[1:]) != my || binary.LittleEndian.Uint16(buf[3:]) != msgID {
			continue // indication or stale
		}
		rtt := time.Since(t0)
		l := int(binary.LittleEndian.Uint16(buf[5:]))
		p := buf[7 : 7+l]
		var out []tlv
		for len(p) >= 3 {
			tl := int(binary.LittleEndian.Uint16(p[1:]))
			if 3+tl > len(p) {
				break
			}
			out = append(out, tlv{p[0], append([]byte(nil), p[3:3+tl]...)})
			p = p[3+tl:]
		}
		return out, rtt, nil
	}
}

// --- little decoding helpers ------------------------------------------------
type rd struct {
	b   []byte
	bad bool
}

func (r *rd) need(n int) bool {
	if len(r.b) < n {
		r.bad = true
		return false
	}
	return true
}
func (r *rd) u8() uint8 {
	if !r.need(1) {
		return 0
	}
	v := r.b[0]
	r.b = r.b[1:]
	return v
}
func (r *rd) i8() int8 { return int8(r.u8()) }
func (r *rd) u16() uint16 {
	if !r.need(2) {
		return 0
	}
	v := binary.LittleEndian.Uint16(r.b)
	r.b = r.b[2:]
	return v
}
func (r *rd) i16() int16 { return int16(r.u16()) }
func (r *rd) u32() uint32 {
	if !r.need(4) {
		return 0
	}
	v := binary.LittleEndian.Uint32(r.b)
	r.b = r.b[4:]
	return v
}
func (r *rd) i32() int32 { return int32(r.u32()) }
func (r *rd) u64() uint64 {
	if !r.need(8) {
		return 0
	}
	v := binary.LittleEndian.Uint64(r.b)
	r.b = r.b[8:]
	return v
}
func (r *rd) bytes(n int) []byte {
	if !r.need(n) {
		return nil
	}
	v := r.b[:n]
	r.b = r.b[n:]
	return v
}

func plmn(b []byte) string {
	if len(b) < 3 {
		return "?"
	}
	d := func(x byte) string {
		if x == 0xf {
			return ""
		}
		return fmt.Sprint(x)
	}
	mcc := d(b[0]&0xf) + d(b[0]>>4) + d(b[1]&0xf)
	mnc := d(b[2]&0xf) + d(b[2]>>4) + d(b[1]>>4)
	return mcc + "-" + mnc
}

func result(ts []tlv) string {
	for _, t := range ts {
		if t.T == 0x02 && len(t.V) >= 4 {
			st := binary.LittleEndian.Uint16(t.V)
			ec := binary.LittleEndian.Uint16(t.V[2:])
			if st == 0 {
				return "OK"
			}
			return fmt.Sprintf("FAIL(err=0x%04x)", ec)
		}
	}
	return "NO-RESULT"
}

func dumpRest(ts []tlv, known map[byte]bool) {
	for _, t := range ts {
		if t.T == 0x02 || (known[t.T] && !verbose) {
			continue
		}
		fmt.Printf("    tlv 0x%02x len=%d %s\n", t.T, len(t.V), hex.EncodeToString(t.V))
	}
}

func ri(x uint8) string {
	m := map[uint8]string{0: "none", 1: "cdma1x", 2: "evdo", 4: "gsm", 5: "umts", 8: "lte", 9: "tdscdma", 0x0c: "nr5g"}
	if s, ok := m[x]; ok {
		return s
	}
	return fmt.Sprintf("ri%d", x)
}

// --- commands ---------------------------------------------------------------
func cmdSig() {
	ts, rtt, err := request(0x004F, nil)
	hdr("nas-get-signal-info 0x004F", ts, rtt, err)
	known := map[byte]bool{0x14: true, 0x17: true, 0x18: true, 0x13: true, 0x12: true}
	for _, t := range ts {
		r := &rd{b: t.V}
		switch t.T {
		case 0x12:
			fmt.Printf("  GSM: rssi=%d dBm\n", r.i8())
		case 0x13:
			fmt.Printf("  WCDMA: rssi=%d ecio=%.1f\n", r.i8(), float64(r.i16())*-0.5)
		case 0x14:
			rssi, rsrq, rsrp, snr := r.i8(), r.i8(), r.i16(), r.i16()
			fmt.Printf("  LTE: rssi=%d dBm rsrq=%d dB rsrp=%d dBm snr=%.1f dB\n", rssi, rsrq, rsrp, float64(snr)/10)
		case 0x17:
			rsrp, snr := r.i16(), r.i16()
			fmt.Printf("  NR5G: rsrp=%d dBm snr=%.1f dB\n", rsrp, float64(snr)/10)
		case 0x18:
			fmt.Printf("  NR5G ext: rsrq=%d dB\n", r.i16())
		}
	}
	dumpRest(ts, known)
}

func cmdCell() {
	ts, rtt, err := request(0x0043, nil)
	hdr("nas-get-cell-location-info 0x0043", ts, rtt, err)
	known := map[byte]bool{0x13: true, 0x14: true}
	for _, t := range ts {
		r := &rd{b: t.V}
		switch t.T {
		case 0x13:
			idle := r.u8()
			pl := plmn(r.bytes(3))
			tac := r.u16()
			gci := r.u32()
			earfcn := r.u16()
			pci := r.u16()
			r.u8()
			r.u8()
			r.u8()
			r.u8()
			n := int(r.u8())
			fmt.Printf("  LTE intra: idle=%d plmn=%s tac=%d(0x%x) gci=%d(0x%x) earfcn=%d pci=%d cells=%d\n", idle, pl, tac, tac, gci, gci, earfcn, pci, n)
			for i := 0; i < n && !r.bad; i++ {
				p, q, rp, rs, lv := r.u16(), r.i16(), r.i16(), r.i16(), r.i16()
				fmt.Printf("    pci=%d rsrq=%.1f rsrp=%.1f rssi=%.1f srxlev=%d\n", p, float64(q)/10, float64(rp)/10, float64(rs)/10, lv)
			}
		case 0x14:
			r.u8()
			nf := int(r.u8())
			fmt.Printf("  LTE inter: freqs=%d\n", nf)
			for f := 0; f < nf && !r.bad; f++ {
				ea := r.u16()
				r.u8()
				r.u8()
				r.u8()
				n := int(r.u8())
				fmt.Printf("    earfcn=%d cells=%d\n", ea, n)
				for i := 0; i < n && !r.bad; i++ {
					p, q, rp, rs, lv := r.u16(), r.i16(), r.i16(), r.i16(), r.i16()
					fmt.Printf("      pci=%d rsrq=%.1f rsrp=%.1f rssi=%.1f srxlev=%d\n", p, float64(q)/10, float64(rp)/10, float64(rs)/10, lv)
				}
			}
		}
	}
	dumpRest(ts, known)
}

func cmdRF() {
	ts, rtt, err := request(0x0031, nil)
	hdr("nas-get-rf-band-info 0x0031", ts, rtt, err)
	known := map[byte]bool{0x01: true, 0x11: true, 0x12: true}
	for _, t := range ts {
		r := &rd{b: t.V}
		n := int(r.u8())
		for i := 0; i < n && !r.bad; i++ {
			switch t.T {
			case 0x01:
				a, b, c := r.u8(), r.u16(), r.u16()
				fmt.Printf("  band: %s band_class=%d chan=%d\n", ri(a), b, c)
			case 0x11:
				a, b, c := r.u8(), r.u16(), r.u32()
				fmt.Printf("  ext:  %s band_class=%d chan=%d\n", ri(a), b, c)
			case 0x12:
				a, b := r.u8(), r.u32()
				fmt.Printf("  bw:   %s bw_enum=%d\n", ri(a), b)
			}
		}
	}
	dumpRest(ts, known)
}

func cmdCA() {
	ts, rtt, err := request(0x00AC, nil)
	hdr("nas-get-lte-cphy-ca-info 0x00AC", ts, rtt, err)
	known := map[byte]bool{0x10: true, 0x11: true, 0x12: true, 0x13: true, 0x14: true}
	for _, t := range ts {
		r := &rd{b: t.V}
		switch t.T {
		case 0x10:
			fmt.Printf("  dl_bw_enum=%d\n", r.u32())
		case 0x11:
			fmt.Printf("  scell: pci=%d earfcn=%d bw_enum=%d band=%d state=%d\n", r.u16(), r.u16(), r.u32(), r.u16(), r.u32())
		case 0x12:
			fmt.Printf("  pcell: pci=%d earfcn=%d bw_enum=%d band=%d\n", r.u16(), r.u16(), r.u32(), r.u16())
		case 0x13:
			fmt.Printf("  scell_idx=%d\n", r.u8())
		case 0x14:
			n := int(r.u8())
			for i := 0; i < n && !r.bad; i++ {
				fmt.Printf("  scell[%d]: pci=%d earfcn=%d bw_enum=%d band=%d state=%d idx=%d\n", i, r.u16(), r.u16(), r.u32(), r.u16(), r.u32(), r.u8())
			}
		}
	}
	dumpRest(ts, known)
}

func cmdTxRx(radio uint8) {
	ts, rtt, err := request(0x005A, []tlv{{0x01, []byte{radio}}})
	hdr(fmt.Sprintf("nas-get-tx-rx-info 0x005A (%s)", ri(radio)), ts, rtt, err)
	known := map[byte]bool{0x10: true, 0x11: true, 0x12: true, 0x13: true, 0x14: true}
	chain := map[byte]int{0x10: 0, 0x11: 1, 0x13: 2, 0x14: 3}
	for _, t := range ts {
		r := &rd{b: t.V}
		switch t.T {
		case 0x10, 0x11, 0x13, 0x14:
			tuned := r.u8()
			pw, ecio, rscp, rsrp, ph := r.i32(), r.i32(), r.i32(), r.i32(), r.u32()
			fmt.Printf("  rx%d: tuned=%d rx_power=%.1f ecio=%.1f rscp=%.1f rsrp=%.1f phase=%d\n", chain[t.T], tuned, float64(pw)/10, float64(ecio)/10, float64(rscp)/10, float64(rsrp)/10, ph)
		case 0x12:
			it := r.u8()
			fmt.Printf("  tx: in_traffic=%d tx_power=%.1f dBm\n", it, float64(r.i32())/10)
		}
	}
	dumpRest(ts, known)
}

func cmdRaw(id uint16) {
	ts, rtt, err := request(id, nil)
	hdr(fmt.Sprintf("raw 0x%04X", id), ts, rtt, err)
	dumpRest(ts, map[byte]bool{})
}

func hdr(name string, ts []tlv, rtt time.Duration, err error) {
	if err != nil {
		fmt.Printf("== %s: ERROR %v (after %.2f ms)\n", name, err, float64(rtt.Microseconds())/1000)
		return
	}
	fmt.Printf("== %s: %s rtt=%.2f ms\n", name, result(ts), float64(rtt.Microseconds())/1000)
}

func main() {
	node := flag.Uint("node", 0, "QRTR node (0 = lookup)")
	port := flag.Uint("port", 0, "QRTR port (0 = lookup)")
	loops := flag.Int("n", 1, "repeat the command list N times")
	flag.BoolVar(&verbose, "v", false, "hex-dump every TLV")
	flag.Parse()
	t0 := time.Now()
	// "qmiprobe time CMD ARGS..." — wall-clock a child process in ms (AT side).
	if flag.NArg() > 1 && flag.Arg(0) == "time" {
		var pa syscall.ProcAttr
		pa.Files = []uintptr{0, 1, 2}
		pa.Env = os.Environ()
		pid, err := syscall.ForkExec(flag.Arg(1), flag.Args()[1:], &pa)
		if err != nil {
			fmt.Fprintln(os.Stderr, "exec:", err)
			os.Exit(1)
		}
		var ws syscall.WaitStatus
		syscall.Wait4(pid, &ws, 0, nil)
		fmt.Printf("# elapsed %.2f ms (exit %d)\n", float64(time.Since(t0).Microseconds())/1000, ws.ExitStatus())
		return
	}
	var err error
	fd, err = syscall.Socket(afQIPCRTR, syscall.SOCK_DGRAM, 0)
	if err != nil {
		fmt.Fprintln(os.Stderr, "socket:", err)
		os.Exit(1)
	}
	defer syscall.Close(fd)
	tv := syscall.Timeval{Sec: 3}
	syscall.SetsockoptTimeval(fd, syscall.SOL_SOCKET, syscall.SO_RCVTIMEO, &tv)
	if *node != 0 || *port != 0 {
		dstNode, dstPort = uint32(*node), uint32(*port)
	} else {
		var ok bool
		tl := time.Now()
		dstNode, dstPort, ok = lookup(svcNAS)
		if !ok {
			fmt.Fprintln(os.Stderr, "NAS service not found")
			os.Exit(2)
		}
		fmt.Printf("# NAS at node=%d port=%d (lookup %.2f ms)\n", dstNode, dstPort, float64(time.Since(tl).Microseconds())/1000)
	}
	cmds := flag.Args()
	if len(cmds) == 0 {
		cmds = []string{"sig", "cell", "rf", "ca", "txrx-lte", "txrx-nr"}
	}
	for i := 0; i < *loops; i++ {
		for _, c := range cmds {
			switch {
			case c == "sig":
				cmdSig()
			case c == "cell":
				cmdCell()
			case c == "rf":
				cmdRF()
			case c == "ca":
				cmdCA()
			case c == "txrx-lte":
				cmdTxRx(0x08)
			case c == "txrx-nr":
				cmdTxRx(0x0c)
			case c == "sysinfo":
				cmdRaw(0x004D)
			case c == "serving":
				cmdRaw(0x0024)
			case c == "dms:0045":
				// DMS Get Band Capabilities (read-only, parameterless)
				n, p, ok := lookup(2)
				if !ok {
					fmt.Println("== DMS service not found")
					continue
				}
				sn, sp := dstNode, dstPort
				dstNode, dstPort = n, p
				cmdRaw(0x0045)
				dstNode, dstPort = sn, sp
			case strings.HasPrefix(c, "get:"):
				// only whitelisted read-only NAS getters
				var id uint16
				fmt.Sscanf(c[4:], "%x", &id)
				allowed := map[uint16]bool{0x0020: true, 0x0024: true, 0x0031: true, 0x0043: true, 0x004D: true, 0x004F: true, 0x005A: true, 0x00AC: true, 0x0034: true}
				if !allowed[id] {
					fmt.Printf("== 0x%04X refused (not in read-only whitelist)\n", id)
					continue
				}
				cmdRaw(id)
			default:
				fmt.Println("unknown cmd", c)
			}
		}
	}
	fmt.Printf("# total process time %.2f ms\n", float64(time.Since(t0).Microseconds())/1000)
}
