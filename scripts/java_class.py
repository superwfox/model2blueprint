"""Read constant references from a vanilla class file without loading or executing Java."""
import struct


class JavaClass:
    def __init__(self, data):
        self.data, self.pos = data, 8
        self.constants = [None]
        count = self.u2()
        while len(self.constants) < count:
            tag = self.u1()
            if tag == 1:
                item = (tag, self.take(self.u2()).decode('utf-8', 'replace'))
            elif tag in (7, 8, 16, 19, 20):
                item = (tag, self.u2())
            elif tag in (9, 10, 11, 12, 17, 18):
                item = (tag, self.u2(), self.u2())
            elif tag == 15:
                item = (tag, self.u1(), self.u2())
            elif tag in (3, 4):
                item = (tag, self.take(4))
            elif tag in (5, 6):
                item = (tag, self.take(8))
            else:
                raise ValueError(f'Unsupported constant tag {tag}')
            self.constants.append(item)
            if tag in (5, 6):
                self.constants.append(None)
        self.take(6)
        self.take(self.u2() * 2)
        self.fields = self.members()
        self.methods = self.members()
        self.attributes = self.attributes_map()
        self.bootstrap = []
        raw = self.attributes.get('BootstrapMethods')
        if raw:
            offset = 2
            for _ in range(struct.unpack_from('>H', raw)[0]):
                handle, size = struct.unpack_from('>HH', raw, offset)
                offset += 4
                args = struct.unpack_from(f'>{size}H', raw, offset)
                offset += size * 2
                self.bootstrap.append((handle, args))

    def take(self, length):
        value = self.data[self.pos:self.pos + length]
        self.pos += length
        return value

    def u1(self):
        return self.take(1)[0]

    def u2(self):
        return struct.unpack('>H', self.take(2))[0]

    def u4(self):
        return struct.unpack('>I', self.take(4))[0]

    def text(self, index):
        return self.constants[index][1]

    def attributes_map(self):
        result = {}
        for _ in range(self.u2()):
            name, length = self.text(self.u2()), self.u4()
            result[name] = self.take(length)
        return result

    def members(self):
        result = {}
        for _ in range(self.u2()):
            access, name, descriptor = self.u2(), self.text(self.u2()), self.text(self.u2())
            result[name] = {'access': access, 'descriptor': descriptor, 'attributes': self.attributes_map()}
        return result

    def reference(self, index):
        item = self.constants[index]
        if item[0] == 8:
            return self.text(item[1])
        if item[0] in (9, 10, 11):
            owner = self.text(self.constants[item[1]][1])
            pair = self.constants[item[2]]
            return (owner, self.text(pair[1]), self.text(pair[2]))
        if item[0] == 18:
            args = self.bootstrap[item[1]][1]
            return [self.reference(self.constants[arg][2]) for arg in args if self.constants[arg][0] == 15]
        return item

    def instructions(self, method):
        raw = self.methods[method]['attributes'].get('Code')
        if not raw:
            return
        length = struct.unpack_from('>I', raw, 4)[0]
        code, i = raw[8:8 + length], 0
        operands = {0x10: 1, 0x11: 2, 0x12: 1, 0x13: 2, 0x14: 2, 0x84: 2, 0xa9: 1,
                    0xb9: 4, 0xba: 4, 0xbb: 2, 0xbc: 1, 0xbd: 2, 0xc0: 2, 0xc1: 2,
                    0xc5: 3, 0xc6: 2, 0xc7: 2, 0xc8: 4, 0xc9: 4}
        operands.update({op: 1 for op in [*range(0x15, 0x1a), *range(0x36, 0x3b)]})
        operands.update({op: 2 for op in [*range(0x99, 0xa9), *range(0xb2, 0xb9)]})
        while i < len(code):
            start, op = i, code[i]
            i += 1
            if op in (0xaa, 0xab):
                i += (-i) % 4
                if op == 0xaa:
                    _, low, high = struct.unpack_from('>iii', code, i)
                    i += 12 + (high - low + 1) * 4
                else:
                    _, pairs = struct.unpack_from('>ii', code, i)
                    i += 8 + pairs * 8
            elif op == 0xc4:
                i += 5 if code[i] == 0x84 else 3
            else:
                i += operands.get(op, 0)
            if op in (0x12, 0x13, 0x14, *range(0xb2, 0xbb)):
                ref = code[start + 1] if op == 0x12 else struct.unpack_from('>H', code, start + 1)[0]
                yield op, self.reference(ref)
