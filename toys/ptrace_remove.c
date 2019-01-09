#include <linux/seccomp.h>
#include <sys/prctl.h>

#include <stdio.h>
#include <unistd.h>

int main(int argc, char **argv)
{
  printf("Hello\n");
  prctl(PR_SET_SECCOMP, SECCOMP_MODE_STRICT);
  printf("World!\n");
  unlink("test_remove");
  return 0;
}