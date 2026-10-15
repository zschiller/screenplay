import math
def oklch_to_lin(L,C,h):
    a=C*math.cos(math.radians(h)); b=C*math.sin(math.radians(h))
    l_=L+0.3963377774*a+0.2158037573*b; m_=L-0.1055613458*a-0.0638541728*b; s_=L-0.0894841775*a-1.2914855480*b
    l,m,s=l_**3,m_**3,s_**3
    # LMS -> XYZ D65
    X= 1.2270138511*l-0.5577999807*m+0.2812561490*s
    Y=-0.0405801784*l+1.1122568696*m-0.0716766787*s
    Z=-0.0763812845*l-0.4214819784*m+1.5861632204*s
    return X,Y,Z
def xyz_to_srgb(X,Y,Z):
    return (3.2409699419*X-1.5373831776*Y-0.4986107603*Z,-0.9692436363*X+1.8759675015*Y+0.0415550574*Z,0.0556300797*X-0.2039769589*Y+1.0569715142*Z)
def xyz_to_p3(X,Y,Z):
    return (2.4934969119*X-0.9313836179*Y-0.4027107845*Z,-0.8294889696*X+1.7626640603*Y+0.0236246858*Z,0.0358458302*X-0.0761723893*Y+0.9568845240*Z)
def inside(rgb,eps=1e-4): return all(-eps<=c<=1+eps for c in rgb)
def maxC(L,h,space):
    lo,hi=0,0.5
    for _ in range(40):
        mid=(lo+hi)/2
        if inside(space(*oklch_to_lin(L,mid,h))): lo=mid
        else: hi=mid
    return lo
def lin_to_xyz_srgb(r,g,b):
    return (0.4123907993*r+0.3575843394*g+0.1804807884*b,0.2126390059*r+0.7151686788*g+0.0721923954*b,0.0193308187*r+0.1191947798*g+0.9505321522*b)
def xyz_to_oklch(X,Y,Z):
    l=0.8190224432*X+0.3619062562*Y-0.1288737815*Z; m=0.0329836671*X+0.9292868468*Y+0.0361446681*Z; s=0.0482003018*X+0.2643662691*Y+0.6338517070*Z
    l,m,s=[math.copysign(abs(v)**(1/3),v) for v in (l,m,s)]
    L=0.2104542553*l+0.7936177850*m-0.0040720468*s; a=1.9779984951*l-2.4285922050*m+0.4505937099*s; b=0.0259040371*l+0.7827717662*m-0.8086757660*s
    return L,math.hypot(a,b),math.degrees(math.atan2(b,a))%360
def clip_srgb(L,C,h):
    r=[min(1,max(0,c)) for c in xyz_to_srgb(*oklch_to_lin(L,C,h))]
    return r, xyz_to_oklch(*lin_to_xyz_srgb(*r))
def enc(c): return 12.92*c if c<=0.0031308 else 1.055*c**(1/2.4)-0.055
def hexs(r): return '#'+''.join('%02x'%round(enc(c)*255) for c in r)
def wcag(Y1,Y2): a,b=max(Y1,Y2),min(Y1,Y2); return (a+.05)/(b+.05)
def lab(X,Y,Z):
    Xn,Yn,Zn=0.95047,1.0,1.08883
    f=lambda t: t**(1/3) if t>216/24389 else (24389/27*t+16)/116
    fx,fy,fz=f(X/Xn),f(Y/Yn),f(Z/Zn)
    L=116*fy-16;a=500*(fx-fy);b=200*(fy-fz)
    return L,math.hypot(a,b),math.degrees(math.atan2(b,a))%360
def hk(L,C,h):
    X,Y,Z=oklch_to_lin(L,C,h); Ls,Cs,hs=lab(X,Y,Z)
    return Ls, Ls+(2.5-0.025*Ls)*(0.116*abs(math.sin(math.radians((hs-90)/2)))+0.085)*Cs
