package api;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Minimal JSON parser - no dependencies, no reflection; runs identically on
 * the JVM and under TeaVM (kept differential-testable). Produces
 * LinkedHashMap / ArrayList / String / Double / Boolean / null.
 * <p>
 * <b>This parser is a trust boundary.</b> Everything it reads originates in the
 * browser, and most of it originates in an {@code .ork} file a stranger can
 * send. It therefore defends itself rather than relying on its callers: the JS
 * side has its own caps, but those only protect the one path that goes through
 * {@code orkImport.ts}, and nothing protects the worker, the tests, or any
 * future direct caller of the facade.
 */
public final class JsonLite {

    /**
     * Nesting limit. Without one, {@code value()}/{@code object()}/{@code array()}
     * recurse until the stack dies: measured at ~3500 levels on the JS target
     * and ~3000 under WASM-GC, and a Web Worker stack is smaller still, so the
     * simulation worker blows first. A stack overflow is also the one failure
     * the two targets disagree about - the JS backend turns it into a catchable
     * RuntimeException, WASM-GC traps straight out of the module - so it must be
     * prevented rather than caught. Real rocket trees nest a handful deep.
     */
    public static final int MAX_DEPTH = 64;

    /**
     * Input limit. The kernel has no business parsing a 100 MB string handed to
     * it by a file; refusing early is cheaper than an out-of-memory browser tab.
     */
    public static final int MAX_INPUT_CHARS = 8 * 1024 * 1024;

    private final String src;
    private int pos;
    private int depth;

    private JsonLite(String src) {
        this.src = src;
    }

    public static Object parse(String json) {
        if (json == null) throw new IllegalArgumentException("JSON: input is null");
        if (json.length() > MAX_INPUT_CHARS) {
            throw new IllegalArgumentException(
                    "JSON: input of " + json.length() + " chars exceeds the " + MAX_INPUT_CHARS + " limit");
        }
        JsonLite p = new JsonLite(json);
        p.ws();
        Object v = p.value();
        p.ws();
        if (p.pos != json.length()) {
            throw new IllegalArgumentException("Trailing content at " + p.pos);
        }
        return v;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseObject(String json) {
        Object v = parse(json);
        if (!(v instanceof Map)) {
            throw new IllegalArgumentException("Expected a JSON object");
        }
        return (Map<String, Object>) v;
    }

    private Object value() {
        char c = peek();
        switch (c) {
            case '{': return object();
            case '[': return array();
            case '"': return string();
            case 't': expect("true"); return Boolean.TRUE;
            case 'f': expect("false"); return Boolean.FALSE;
            case 'n': expect("null"); return null;
            default: return number();
        }
    }

    private Map<String, Object> object() {
        Map<String, Object> map = new LinkedHashMap<>();
        enter();
        consume('{');
        ws();
        if (peek() == '}') {
            pos++;
            depth--;
            return map;
        }
        while (true) {
            ws();
            String key = string();
            ws();
            consume(':');
            ws();
            // A duplicate key silently overwrote, so a file could carry two
            // answers for one field and the last one won with nothing said.
            if (map.containsKey(key)) {
                throw new IllegalArgumentException("JSON: duplicate key '" + key + "' at " + pos);
            }
            map.put(key, value());
            ws();
            char c = next();
            if (c == '}') {
                depth--;
                return map;
            }
            if (c != ',') throw err("',' or '}'");
        }
    }

    private List<Object> array() {
        List<Object> list = new ArrayList<>();
        enter();
        consume('[');
        ws();
        if (peek() == ']') {
            pos++;
            depth--;
            return list;
        }
        while (true) {
            ws();
            list.add(value());
            ws();
            char c = next();
            if (c == ']') {
                depth--;
                return list;
            }
            if (c != ',') throw err("',' or ']'");
        }
    }

    private void enter() {
        if (++depth > MAX_DEPTH) {
            throw new IllegalArgumentException(
                    "JSON: nesting deeper than " + MAX_DEPTH + " at " + pos);
        }
    }

    private String string() {
        consume('"');
        StringBuilder sb = new StringBuilder();
        while (true) {
            char c = next();
            if (c == '"') return sb.toString();
            if (c == '\\') {
                char e = next();
                switch (e) {
                    case '"': sb.append('"'); break;
                    case '\\': sb.append('\\'); break;
                    case '/': sb.append('/'); break;
                    case 'b': sb.append('\b'); break;
                    case 'f': sb.append('\f'); break;
                    case 'n': sb.append('\n'); break;
                    case 'r': sb.append('\r'); break;
                    case 't': sb.append('\t'); break;
                    case 'u':
                        // Integer.parseInt(..., 16) accepts a sign and throws a
                        // StringIndexOutOfBounds on a truncated escape, so
                        // "\\u-123" silently injected (char) -291 into a
                        // component name and "\\u12" threw the wrong exception
                        // type. Validate all four digits are hex first.
                        if (pos + 4 > src.length()) throw err("4 hex digits after \\u");
                        int cp = 0;
                        for (int k = 0; k < 4; k++) {
                            int d = Character.digit(src.charAt(pos + k), 16);
                            if (d < 0) throw err("4 hex digits after \\u");
                            cp = (cp << 4) | d;
                        }
                        sb.append((char) cp);
                        pos += 4;
                        break;
                    default: throw err("escape");
                }
            } else {
                sb.append(c);
            }
        }
    }

    private Double number() {
        int start = pos;
        while (pos < src.length() && "+-0123456789.eE".indexOf(src.charAt(pos)) >= 0) {
            pos++;
        }
        if (start == pos) throw err("number");
        final String text = src.substring(start, pos);
        final double d;
        try {
            d = Double.parseDouble(text);
        } catch (NumberFormatException e) {
            // NumberFormatException carries a null message here, which reached
            // the UI verbatim as "null" via services/buildRocket.ts.
            throw new IllegalArgumentException("JSON: bad number '" + text + "' at " + start);
        }
        // An exponent overflow used to become Infinity with no error at all:
        // `"length":1e999` built a rocket whose every StaticInfo field then
        // serialized as null, because the writer sanitizes non-finite values
        // and the JS side only checks for an `error` key. Refuse it at the door.
        if (Double.isNaN(d) || Double.isInfinite(d)) {
            throw new IllegalArgumentException("JSON: non-finite number '" + text + "' at " + start);
        }
        return Double.valueOf(d);
    }

    private void ws() {
        while (pos < src.length() && Character.isWhitespace(src.charAt(pos))) {
            pos++;
        }
    }

    private char peek() {
        if (pos >= src.length()) throw err("value");
        return src.charAt(pos);
    }

    private char next() {
        if (pos >= src.length()) throw err("more input");
        return src.charAt(pos++);
    }

    private void consume(char c) {
        if (next() != c) throw err("'" + c + "'");
    }

    private void expect(String word) {
        if (!src.startsWith(word, pos)) throw err(word);
        pos += word.length();
    }

    private IllegalArgumentException err(String expected) {
        return new IllegalArgumentException("JSON: expected " + expected + " at " + pos);
    }

    // ---- typed accessors for builder code ----

    // An ABSENT key legitimately falls back to the default. A key that is
    // PRESENT but of the wrong type is a caller bug or a bad file, and silently
    // falling back meant `"length":"0.9"` (a quoted number from a lax exporter)
    // built a 0.3 m body tube - the default - and reported success. Different
    // rocket, no warning.
    private static IllegalArgumentException wrongType(String key, Object v, String want) {
        return new IllegalArgumentException(
                "JSON: key '" + key + "' should be " + want + ", got " + v.getClass().getSimpleName());
    }

    public static double dbl(Map<String, Object> m, String key, double fallback) {
        Object v = m.get(key);
        if (v == null) return fallback;
        if (!(v instanceof Double)) throw wrongType(key, v, "a number");
        return (Double) v;
    }

    public static boolean bool(Map<String, Object> m, String key, boolean fallback) {
        Object v = m.get(key);
        if (v == null) return fallback;
        if (!(v instanceof Boolean)) throw wrongType(key, v, "a boolean");
        return (Boolean) v;
    }

    public static String str(Map<String, Object> m, String key, String fallback) {
        Object v = m.get(key);
        if (v == null) return fallback;
        if (!(v instanceof String)) throw wrongType(key, v, "a string");
        return (String) v;
    }

    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> objList(Map<String, Object> m, String key) {
        Object v = m.get(key);
        if (!(v instanceof List)) return new ArrayList<>();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object o : (List<Object>) v) {
            if (o instanceof Map) out.add((Map<String, Object>) o);
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> obj(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v instanceof Map ? (Map<String, Object>) v : null;
    }
}
