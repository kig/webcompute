ISPC=ispc
FLAGS=
TARGET=kernel
BITS=64

MY_PLATFORM := $(shell uname | tr [[:upper:]] [[:lower:]] | sed s/darwin/macos/ | sed -E s/mingw.*/windows/ )
MY_ARCH := $(shell uname -m | tr _ -)

ifeq ($(MY_PLATFORM),linux)
  ifeq ($(shell uname -o),Android)
    MY_PLATFORM := android
  endif
endif

CXX=clang++

PLATFORM := $(MY_PLATFORM)
ARCH := $(MY_ARCH)

RUNNER=objs/runner-$(PLATFORM)-$(ARCH).o
TASKSYS=objs/tasksys-$(PLATFORM)-$(ARCH).o

ifeq ($(ARCH),arm)
	# Raspberry Pi settings
	LINK_FLAGS=-stdlib=libc++ -lunwind -mfloat-abi=hard
	BITS=32
endif

ifeq ($(PLATFORM),windows)

link:
	mkdir -p targets/$(TARGET)/windows
	cp windows/* targets/$(TARGET)/windows/
	cp targets/$(TARGET)/program.o targets/$(TARGET)/windows/program.obj
	(cd targets/$(TARGET)/windows; "/c/Program Files (x86)/Microsoft Visual Studio/2017/Community/MSBuild/15.0/Bin/amd64/MSBuild.exe" "-p:Configuration=Release;Platform=x64"; mv x64/Release/runner.exe ../program.exe)

runner:
	cd windows
	"/c/Program Files (x86)/Microsoft Visual Studio/2017/Community/MSBuild/15.0/Bin/amd64/MSBuild.exe" "-p:Configuration=Release;Platform=x64"

tasksys:
	cd windows
	"/c/Program Files (x86)/Microsoft Visual Studio/2017/Community/MSBuild/15.0/Bin/amd64/MSBuild.exe" "-p:Configuration=Release;Platform=x64"

else

link:
	$(CXX) -Iobjs/ -O2 -m$(BITS) -o targets/$(TARGET)/program $(RUNNER) $(TASKSYS) targets/$(TARGET)/program.o -lm -lpthread -lstdc++ $(LINK_FLAGS)

runner:
	$(CXX) runner.cpp -Iobjs/ -O2 -m$(BITS) -c -o $(RUNNER)

tasksys:
	$(CXX) tasksys.cpp -Iobjs/ -O2 -m$(BITS) -c -o $(TASKSYS)

endif

default: ispc link

ispc:
	../$(ISPC)-$(ARCH)-$(MY_PLATFORM)-$(MY_ARCH) $(FLAGS) -O2 targets/$(TARGET)/program.ispc -o targets/$(TARGET)/program.o


all: tasksys runner ispc link
