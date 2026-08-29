package info.openrocket.core.util;

import java.util.Collection;

/**
 * An implementation of an ArrayList with a type-safe {@link #clone()} method.
 * 
 * @author Sampo Niskanen <sampo.niskanen@iki.fi>
 */
public class ArrayList<E> extends java.util.ArrayList<E> {

	public ArrayList() {
		super();
	}

	public ArrayList(Collection<? extends E> c) {
		super(c);
	}

	public ArrayList(int initialCapacity) {
		super(initialCapacity);
	}

	@Override
	public ArrayList<E> clone() {
		// PATCH(astrarrocketjs, WASM-GC): construct the subclass + copy instead of
		// (ArrayList<E>) super.clone(). TeaVM's java.util.ArrayList.clone() does not
		// preserve the runtime subclass, so the cast throws ClassCastException under
		// WASM-GC's strict typing (and under the JS backend's strict=true). A shallow
		// element copy into a new ArrayList<E> is behavior-equivalent and cast-free.
		return new ArrayList<>(this);
	}

}
