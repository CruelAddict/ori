package cloneutil

import "slices"

func Ptr[T any](src *T) *T {
	if src == nil {
		return nil
	}
	v := *src
	return &v
}

func Slice[T any](src []T) []T {
	return slices.Clone(src)
}

func SlicePtr[T any](src *[]T) *[]T {
	if src == nil {
		return nil
	}
	values := slices.Clone(*src)
	return &values
}

func SlicePtrIfNotEmpty[T any](src []T) *[]T {
	if len(src) == 0 {
		return nil
	}
	values := src
	return &values
}
